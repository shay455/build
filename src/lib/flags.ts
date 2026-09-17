import type { Flag, Property } from '@/types/property';
import type { Economics } from './finance';
import { count, shekel } from './format';

/**
 * What a listing will not tell you. Order matters: blockers first, then checks, then upside.
 * A critical flag never hides a property — it costs it points and states why.
 */
export function flagsFor(p: Property, e: Economics): Flag[] {
  const out: Flag[] = [];

  if (p.splitPermit === 'unknown') {
    out.push({
      level: 'crit',
      text: 'יחידת דיור — לא אותר היתר פיצול. בלי היתר, בנק עלול לסרב למשכנתא והרשות המקומית רשאית להוציא צו.',
    });
  } else if (p.splitPermit === 'none') {
    out.push({ level: 'crit', text: 'יחידת דיור ללא היתר פיצול.' });
  }

  if (p.tenure === 'lease' && p.leaseEndsAt) {
    out.push({ level: 'warn', text: `חכירה עד ${p.leaseEndsAt} — לבדוק יתרת חכירה ודמי היוון לפני משכנתא.` });
  }
  if (p.registryKind === 'housingCompany') {
    out.push({ level: 'warn', text: 'הזכויות רשומות בחברה משכנת ולא בטאבו — רישום העברה איטי ויקר יותר.' });
  }
  if (p.caveats > 0) {
    out.push({
      level: 'warn',
      text: `${count(p.caveats, 'הערת אזהרה אחת רשומה', 'הערות אזהרה רשומות')} — לבדוק את תוכנן בנסח.`,
    });
  }
  if (!p.registryVerified) {
    out.push({ level: 'warn', text: 'הרישום לא אומת מול נסח טאבו. הזמנת נסח היא הפעולה הבאה.' });
  }
  if (e.deltaVsArea !== null && e.deltaVsArea < -0.18) {
    out.push({
      level: 'warn',
      text: `מחיר נמוך ב־${Math.round(Math.abs(e.deltaVsArea) * 100)}% מחציון האזור. פער כזה בדרך כלל מוסבר — לברר לפני התלהבות.`,
    });
  }
  if (p.builtYear < 1992 && !p.features.mamad) {
    out.push({ level: 'warn', text: `אין ממ״ד (בניין משנת ${p.builtYear}).` });
  }
  if (p.floor >= 3 && !p.features.elevator) {
    out.push({ level: 'warn', text: `קומה ${p.floor} ללא מעלית.` });
  }
  if (p.bettermentRisk === 'high') {
    out.push({ level: 'warn', text: 'חשיפה להיטל השבחה — קיימות זכויות בנייה לא מנוצלות.' });
  }
  if (p.daysOnMarket > 90) {
    out.push({ level: 'warn', text: `${p.daysOnMarket} ימים בשוק — מרחב למשא ומתן, ואולי גם סיבה.` });
  }

  if (p.priceDrop > 0) {
    out.push({ level: 'ok', text: `ירד ב־${shekel(p.priceDrop)} מאז הפרסום.` });
  }
  if (p.urbanRenewal) {
    out.push({ level: 'ok', text: `${p.urbanRenewal}${p.renewalStage ? ` · ${p.renewalStage}` : ''}.` });
  }
  if (e.deltaVsArea !== null && e.deltaVsArea <= -0.06 && e.deltaVsArea >= -0.18) {
    out.push({ level: 'ok', text: `מתומחר ${Math.round(Math.abs(e.deltaVsArea) * 100)}% מתחת לחציון האזור.` });
  }
  if (p.deal === 'rent' && p.fairRentLaw) {
    out.push({ level: 'ok', text: 'חוק השכירות ההוגנת חל — פיקדון מוגבל ותיקונים באחריות המשכיר.' });
  }

  return out;
}
