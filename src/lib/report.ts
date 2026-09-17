import type { BuyerProfile, Flag, Property } from '@/types/property';
import type { SearchResult } from './search';
import { count, num, pct, ratePct, shekel } from './format';
import { ASSET_TYPE_LABEL } from './query';
import { ADDITIONAL_HOME_ORDER_EXPIRES } from './tax';
import { DEFAULT_MORTGAGE } from './finance';

export interface ReportRow {
  label: string;
  value: string;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
  note?: string;
}

export type CheckSeverity = 'blocking' | 'required' | 'advised';

export interface ChecklistItem {
  severity: CheckSeverity;
  title: string;
  why: string;
}

export interface PropertyReport {
  generatedAt: string;
  title: string;
  subtitle: string;
  profileLabel: string;
  sections: ReportSection[];
  flags: Flag[];
  checklist: ChecklistItem[];
  disclaimer: string;
}

const PROFILE_LABEL: Record<BuyerProfile, string> = {
  single: 'דירה יחידה',
  upgrade: 'משפר דיור',
  additional: 'דירה נוספת / השקעה',
  oleh: 'עולה חדש — תקנה 12א',
  reg11: 'זכאי תקנה 11',
};
const CONDITION_LABEL = { new: 'חדש', renovated: 'משופץ', kept: 'שמור', needsWork: 'דורש שיפוץ' } as const;
const REGISTRY_LABEL = { tabu: 'טאבו', rmi: 'רמ״י', housingCompany: 'חברה משכנת' } as const;
const BETTERMENT_LABEL = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' } as const;
const SOURCE_LABEL: Record<string, string> = {
  manual: 'הוזן ידנית',
  nadlan: 'נדל״ן — רשות המסים',
  fixture: 'נתוני דוגמה מקומיות',
};

export const DISCLAIMER =
  'מסמך זה הופק אוטומטית על ידי מודל בינה מלאכותית, ללא מעורבות, בדיקה או אישור של שמאי מקרקעין מוסמך, ' +
  'עורך דין או יועץ מס. הוא אינו שומת מקרקעין, אינו חוות דעת מקצועית ואינו ייעוץ משפטי או מיסויי, אלא ריכוז ' +
  'מידע בלבד: הוא אינו כולל ביקור בנכס, אינו מבצע את התאמות שיטת ההשוואה הנדרשות, ואינו בוחן את מסמכי העסקה ' +
  'הספציפית. מודל בינה מלאכותית עלול לטעות או להשמיט נתונים. אין להציג מסמך זה כשומה מוסמכת, אין להסתמך עליו ' +
  'כראיה ואין להגישו לבית משפט או לרשות. הערכת שווי מחייבת דורשת שמאי מוסמך, עסקת מקרקעין דורשת עורך דין, ' +
  'וחישוב מס מחייב דורש יועץ מס או רואה חשבון. כל הסכומים משוערים.';

/**
 * What still has to be checked before signing anything.
 *
 * This is the part of the report that is worth handing to a lawyer: it is derived
 * from what the record does and does not say, so "we did not check" produces an
 * item rather than silence.
 */
export function buildChecklist(p: Property, profile: BuyerProfile): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  if (p.splitPermit === 'unknown' || p.splitPermit === 'none') {
    items.push({
      severity: 'blocking',
      title: 'היתר פיצול ליחידת הדיור — בדיקה בוועדה המקומית',
      why:
        p.splitPermit === 'none'
          ? 'הנכס מסומן כיחידה מפוצלת ללא היתר. בלי היתר, בנק עלול לסרב למשכנתא והרשות רשאית להוציא צו.'
          : 'לא אותר היתר פיצול. עד שיימצא, אין לראות את הפיצול, את שני השוכרים או את התשואה הנובעת מהם כנתון.',
    });
  }

  if (p.tenure === 'lease') {
    items.push({
      severity: 'blocking',
      title: `יתרת חכירה ודמי היוון${p.leaseEndsAt ? ` (מסתיימת ${p.leaseEndsAt})` : ''}`,
      why: 'יתרת חכירה קצרה משפיעה על אישור המשכנתא ועל השווי. יש לברר גם אם החכירה מהוונת.',
    });
  }

  items.push({
    severity: p.registryVerified ? 'required' : 'blocking',
    title: 'נסח טאבו מעודכן',
    why: p.registryVerified
      ? 'הנתונים במסמך זה מבוססים על בדיקה קודמת. לפני חתימה נדרש נסח עדכני למועד העסקה.'
      : 'הרישום לא אומת. הבעלות, השעבודים והערות האזהרה במסמך זה אינם מאומתים מול המקור.',
  });

  if (p.registryKind === 'housingCompany') {
    items.push({
      severity: 'required',
      title: 'מסלול רישום ההעברה מול החברה המשכנת',
      why: 'הזכויות אינן רשומות בטאבו. רישום ההעברה איטי ויקר יותר, ויש לברר מי החברה ומה נדרש ממנה.',
    });
  }

  if (p.caveats > 0) {
    items.push({
      severity: 'required',
      title: `מהות ${count(p.caveats, 'הערת האזהרה הרשומה', 'הערות האזהרה הרשומות')}`,
      why: 'הערת אזהרה יכולה להיות שגרתית או לחסום עסקה. יש לקרוא את תוכנה בנסח ולא להסתמך על מספרן.',
    });
  }

  if (p.mortgages > 0) {
    items.push({
      severity: 'required',
      title: `סילוק ${count(p.mortgages, 'המשכנתא הרשומה', 'המשכנתאות הרשומות')}`,
      why: 'יש לוודא מסלול סילוק ומחיקת השעבוד במסגרת העסקה, ולתאם את לוח התשלומים סביבו.',
    });
  }

  if (p.bettermentRisk === 'high' || p.bettermentRisk === 'medium') {
    items.push({
      severity: 'required',
      title: 'היטל השבחה מול הרשות המקומית',
      why: 'קיימות זכויות בנייה לא מנוצלות. ההיטל הוא 50% מעליית השווי בעקבות תוכנית, ומשולם במימוש — בדרך כלל על ידי המוכר, אך הדבר נתון להסכמה.',
    });
  }

  if (p.urbanRenewal) {
    items.push({
      severity: 'advised',
      title: `שלב ההליך ב${p.urbanRenewal}`,
      why: `מצב ההליך המדווח: ${p.renewalStage ?? 'לא ידוע'}. יש לבדוק את הסכם היזם, את אחוז החתימות ואת לוחות הזמנים.`,
    });
  }

  if (p.builtYear < 1992 && !p.features.mamad) {
    items.push({
      severity: 'advised',
      title: 'אין ממ״ד — בדיקת מקלט ופתרון מיגון',
      why: `הבניין משנת ${p.builtYear}. יש לבדוק קיום מקלט תקין ומרחק אליו.`,
    });
  }

  if (p.marketStatus !== 'ok') {
    items.push({
      severity: 'required',
      title: 'אימות שווי מול עסקאות השוואה',
      why:
        p.marketStatus === 'manual'
          ? 'חציון האזור במסמך זה הוזן ידנית ולא נשלף ממקור רשמי.'
          : p.marketStatus === 'thin'
            ? `המדגם מונה ${p.marketSampleSize} עסקאות בלבד — קטן מכדי לגזור ממנו אחוז.`
            : 'לא אותרו עסקאות השוואה לנכס זה.',
    });
  }

  if (p.deal === 'sale') {
    items.push({
      severity: 'required',
      title: 'הצהרת מס רכישה',
      why: 'הצהרה תוך 30 יום מחתימת ההסכם, תשלום תוך 60 יום. חישוב המס במסמך זה משוער ואינו מחייב.',
    });
    if (profile === 'upgrade') {
      items.push({
        severity: 'blocking',
        title: 'חלון מכירת הדירה הקיימת',
        why: 'מסלול דירה יחידה מותנה במכירה בחלון הסטטוטורי (ככלל 24 חודשים; 12 חודשים מקבלן ממועד המסירה החוזי) ובהצהרה על כך בדיווח. אי-עמידה בחלון מחזירה את החיוב לשיעורי דירה נוספת.',
      });
    }
    if (profile === 'additional') {
      items.push({
        severity: 'required',
        title: 'תוקף שיעורי הדירה הנוספת',
        why: `שיעורי 8%/10% הם הוראת שעה בתוקף עד ${ADDITIONAL_HOME_ORDER_EXPIRES}. יש לאמת אם הוארכה לפני הסתמכות על החישוב.`,
      });
    }
    if (profile === 'oleh' || profile === 'reg11') {
      items.push({
        severity: 'required',
        title: 'הגשת בקשה להקלה במס רכישה',
        why: 'ההקלה אינה אוטומטית. יש להגיש בקשה לרשות המסים, ובחלק מהמסלולים נדרשת ועדה רפואית של ביטוח לאומי מראש.',
      });
    }
  } else {
    items.push({
      severity: 'required',
      title: 'התאמת החוזה לחוק השכירות (שכירות הוגנת)',
      why: 'יש לבדוק תחולת החוק על הנכס, את תקרת הפיקדון, את חלוקת האחריות לתיקונים ואת תנאי היציאה.',
    });
  }

  items.push({
    severity: 'required',
    title: 'ביקור בנכס והתאמה בין המצוי לרשום',
    why: 'מסמך זה אינו כולל ביקור. יש להשוות את השטח, החלוקה והתוספות למה שמופיע בתשריט ובהיתר.',
  });

  const order: Record<CheckSeverity, number> = { blocking: 0, required: 1, advised: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Assemble the full report. Pure, so it is testable and reusable by any renderer. */
export function buildReport(result: SearchResult, profile: BuyerProfile, now = new Date()): PropertyReport {
  const { property: p, economics: e, score, flags } = result;
  const sale = p.deal === 'sale';

  const sections: ReportSection[] = [];

  sections.push({
    title: 'זיהוי הנכס',
    rows: [
      { label: 'סוג', value: ASSET_TYPE_LABEL[p.assetType] },
      { label: 'כתובת', value: `${p.street || '—'}, ${p.neighborhood || '—'}, ${p.city}` },
      { label: 'גוש / חלקה / תת־חלקה', value: `${p.gush} / ${p.helka}${p.tatHelka ? ` / ${p.tatHelka}` : ''}` },
      { label: 'חדרים', value: String(p.rooms) },
      { label: 'שטח בנוי', value: `${p.sqm} מ״ר` },
      { label: 'מרפסת', value: p.balconySqm > 0 ? `${p.balconySqm} מ״ר` : 'אין' },
      ...(p.lotSqm ? [{ label: 'שטח מגרש', value: `${p.lotSqm} מ״ר` }] : []),
      { label: 'קומה', value: p.floor === 0 ? `קרקע, מתוך ${p.floorsInBuilding}` : `${p.floor} מתוך ${p.floorsInBuilding}` },
      { label: 'שנת בנייה', value: String(p.builtYear) },
      { label: 'מצב', value: CONDITION_LABEL[p.condition] },
      { label: 'כיווני אוויר', value: p.aspects || '—' },
      { label: 'תאריך כניסה', value: p.availableFrom },
    ],
  });

  sections.push({
    title: 'מאפיינים',
    rows: [
      { label: 'מעלית', value: p.features.elevator ? 'יש' : 'אין' },
      { label: 'חניות', value: String(p.features.parking) },
      { label: 'מחסן', value: p.features.storage ? 'יש' : 'אין' },
      { label: 'ממ״ד', value: p.features.mamad ? 'יש' : 'אין' },
      { label: 'מיזוג', value: p.features.ac },
      { label: 'גישה לנכים', value: p.features.accessible ? 'יש' : 'אין' },
      { label: 'כניסה נפרדת', value: p.features.separateEntrance ? 'יש' : 'אין' },
      { label: 'מרוהט', value: p.features.furnished ? 'כן' : 'לא' },
    ],
  });

  sections.push({
    title: sale ? 'מחיר ושוק' : 'שכר דירה ושוק',
    rows: [
      { label: sale ? 'מחיר מבוקש' : 'שכר דירה לחודש', value: shekel(p.price) },
      ...(sale && e.ppsm !== null ? [{ label: 'מחיר למ״ר', value: shekel(e.ppsm) }] : []),
      ...(sale ? [{ label: 'חציון האזור למ״ר', value: p.areaMedianPpsm > 0 ? shekel(p.areaMedianPpsm) : 'אין נתון' }] : [{ label: 'שכ״ד אזורי', value: p.areaMedianRent > 0 ? shekel(p.areaMedianRent) : 'אין נתון' }]),
      {
        label: 'פער מול האזור',
        value:
          e.deltaVsArea !== null
            ? pct(e.deltaVsArea)
            : e.comparableBasis === 'thin'
              ? `לא חושב — מדגם של ${p.marketSampleSize} עסקאות בלבד`
              : 'לא חושב — אין בסיס השוואה',
      },
      { label: 'מקור נתוני השוק', value: SOURCE_LABEL[p.marketSourceId] ?? p.marketSourceId },
      { label: 'מדגם', value: p.marketSampleSize > 0 ? `${num(p.marketSampleSize)} עסקאות` : 'לא נשלף ממקור' },
      { label: 'העסקה האחרונה במדגם', value: p.marketAsOf || '—' },
      ...(p.priceDrop > 0 ? [{ label: 'ירידת מחיר מאז הפרסום', value: shekel(p.priceDrop) }] : []),
      { label: 'ימים בשוק', value: String(p.daysOnMarket) },
    ],
    note: 'הפער מול האזור הוא אינדיקציה ולא שומה: ללא ביקור בנכס וללא התאמות שיטת ההשוואה שהחוק דורש משמאי.',
  });

  if (sale && e.tax && e.closing) {
    sections.push({
      title: `מס רכישה ועלות כניסה — מסלול ${PROFILE_LABEL[profile]}`,
      rows: [
        ...e.tax.brackets.map((b) => ({
          label: `${num(b.from)}–${b.to === Infinity ? 'ומעלה' : num(b.to)} · ${ratePct(b.rate)}`,
          value: shekel(b.amount),
        })),
        { label: 'מס רכישה משוער', value: shekel(e.tax.amount) },
        { label: 'שיעור אפקטיבי', value: pct(e.tax.effectiveRate, 2) },
        { label: 'עו״ד (משוער)', value: shekel(e.closing.lawyer) },
        { label: `תיווך${p.publisherKind === 'agency' ? ` ${p.agentFeePct}% + מע״מ` : ''}`, value: e.closing.agent > 0 ? shekel(e.closing.agent) : '—' },
        { label: 'שמאי ואגרות', value: shekel(e.closing.appraiser + e.closing.misc) },
        { label: 'סה״כ עלות כניסה', value: shekel(e.acquisitionTotal ?? 0) },
        { label: 'מגבלת מימון (LTV)', value: pct(e.ltv ?? 0, 0) },
        { label: 'הון עצמי נדרש', value: shekel(e.equityRequired ?? 0) },
      ],
      note: e.tax.notes.join(' '),
    });

    sections.push({
      title: 'עלות חודשית ותשואה',
      rows: [
        { label: `החזר משכנתא (${pct(DEFAULT_MORTGAGE.annualRate, 2)}, ${DEFAULT_MORTGAGE.years} שנים)`, value: shekel(e.monthlyMortgage ?? 0) },
        { label: 'ארנונה', value: shekel(p.arnona) },
        { label: 'ועד בית', value: shekel(p.vaad) },
        { label: 'סה״כ חודשי', value: shekel(e.monthlyAllIn) },
        { label: 'שכ״ד צפוי', value: shekel(p.expectedMonthlyRent) },
        { label: 'תשואה ברוטו', value: pct(e.grossYield ?? 0, 2) },
        { label: 'תשואה נטו על עלות כוללת', value: pct(e.netYield ?? 0, 2) },
        { label: 'תזרים חודשי מול משכנתא', value: shekel(e.monthlyCashflow ?? 0) },
      ],
      note: 'תשואה נטו מחושבת בניכוי 4% תקופות ריקות, 5% תחזוקה, ביטוח וועד בית, וחלקי עלות הרכישה הכוללת. תקרת הפטור ממס על הכנסה משכירות אינה מגולמת.',
    });
  } else {
    sections.push({
      title: 'עלות חודשית',
      rows: [
        { label: 'שכר דירה', value: shekel(p.price) },
        { label: 'ארנונה', value: shekel(p.arnona) },
        { label: 'ועד בית', value: shekel(p.vaad) },
        { label: 'חשמל ומים (משוער)', value: shekel(p.utilities) },
        { label: 'סה״כ חודשי', value: shekel(e.monthlyAllIn) },
        { label: 'פיקדון', value: `${p.depositMonths} חודשים (${shekel(e.deposit ?? 0)})` },
        { label: 'תקופה מינימלית', value: `${p.minLeaseMonths} חודשים` },
        { label: 'חיות מחמד', value: p.petsAllowed ? 'מותר' : 'לא מותר' },
      ],
    });
  }

  sections.push({
    title: 'רישום ותכנון',
    rows: [
      { label: 'מערכת רישום', value: REGISTRY_LABEL[p.registryKind] },
      { label: 'סוג זכות', value: p.tenure === 'lease' ? `חכירה${p.leaseEndsAt ? ` עד ${p.leaseEndsAt}` : ''}` : 'בעלות' },
      { label: 'הערות אזהרה', value: p.caveats === 0 ? 'לא נמצאו' : String(p.caveats) },
      { label: 'משכנתאות רשומות', value: String(p.mortgages) },
      { label: 'אומת מול נסח', value: p.registryVerified ? 'אומת' : 'לא אומת' },
      { label: 'היתר פיצול', value: p.splitPermit === null ? 'לא רלוונטי' : p.splitPermit === 'granted' ? 'קיים' : p.splitPermit === 'none' ? 'אין' : 'לא אותר' },
      { label: 'התחדשות עירונית', value: p.urbanRenewal ? `${p.urbanRenewal}${p.renewalStage ? ` · ${p.renewalStage}` : ''}` : 'אין תוכנית פעילה' },
      { label: 'חשיפה להיטל השבחה', value: p.bettermentRisk ? BETTERMENT_LABEL[p.bettermentRisk] : '—' },
    ],
  });

  if (sale && p.comparables.length > 0) {
    sections.push({
      title: 'עסקאות השוואה',
      rows: p.comparables.map((c) => ({
        label: `${c.date} · ${c.sqm} מ״ר`,
        value: `${shekel(c.price)} (${shekel(c.price / c.sqm)} למ״ר)`,
      })),
    });
  }

  sections.push({
    title: 'מקור המודעה',
    rows: [
      { label: 'מקור', value: p.source },
      { label: 'תאריך פרסום', value: p.publishedAt },
      { label: 'מפרסם', value: p.publisherKind === 'agency' ? `תיווך · ${p.agentFeePct}%` : 'פרטי' },
      { label: 'ציון התאמה', value: `${score.value} מתוך 100${score.reasons.length ? ` (${score.reasons.join(', ')})` : ''}` },
    ],
  });

  return {
    generatedAt: now.toISOString().slice(0, 10),
    title: `דוח נכס — ${ASSET_TYPE_LABEL[p.assetType]} ${p.rooms} חדרים, ${p.neighborhood || p.city}`,
    subtitle: `${p.street || ''}${p.street ? ', ' : ''}${p.city} · גוש ${p.gush} חלקה ${p.helka}${p.tatHelka ? `/${p.tatHelka}` : ''}`,
    profileLabel: PROFILE_LABEL[profile],
    sections,
    flags,
    checklist: buildChecklist(p, profile),
    disclaimer: DISCLAIMER,
  };
}
