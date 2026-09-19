'use client';

import { useState } from 'react';
import { AddressLookup, type ResolvedAddress } from './AddressLookup';
import { PasteListing } from './PasteListing';
import type { ExtractedListing } from '@/lib/extract';
import { ASSET_TYPE_LABEL } from '@/lib/query';
import { CSV_COLUMNS } from '@/lib/csv';
import type { AssetType } from '@/types/property';

interface Issue {
  path: (string | number)[];
  message: string;
}

const field = 'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:border-accent';
const labelCls = 'mb-1 block text-[11px] font-bold tracking-wider text-muted';

function Field({ name, label, children }: { name: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls} htmlFor={name}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-line bg-surface p-4">
      <legend className="px-1 font-display text-base font-bold">{title}</legend>
      {hint && <p className="mb-3 text-xs text-muted">{hint}</p>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">{children}</div>
    </fieldset>
  );
}

const CHECKBOXES: Array<[string, string]> = [
  ['elevator', 'מעלית'],
  ['storage', 'מחסן'],
  ['mamad', 'ממ״ד'],
  ['accessible', 'גישה לנכים'],
  ['furnished', 'מרוהט'],
  ['bars', 'סורגים'],
  ['separateEntrance', 'כניסה נפרדת'],
  ['registryVerified', 'הרישום אומת מול נסח טאבו'],
];

export function AddPropertyForm() {
  const [assetType, setAssetType] = useState<AssetType>('apartment');
  const [deal, setDeal] = useState<'sale' | 'rent'>('sale');
  // These four are controlled so the address lookup can fill them.
  const [location, setLocation] = useState<ResolvedAddress>({ city: '', street: '', gush: '', helka: '' });
  /**
   * Values pulled out of a pasted listing. The uncontrolled inputs read them as
   * defaults, and bumping `formKey` remounts the fieldsets so new defaults take.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [formKey, setFormKey] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });
  const [busy, setBusy] = useState(false);

  const issueFor = (name: string) => issues.find((i) => i.path[0] === name)?.message;
  const d = (name: string, fallback = '') => draft[name] ?? fallback;

  /** Map an extraction onto the form. Only fields the text actually supplied are touched. */
  function applyExtracted(e: ExtractedListing) {
    const next: Record<string, string> = {};
    const put = (key: string, field?: { value: unknown }) => {
      if (field !== undefined) next[key] = String(field.value);
    };

    put('price', e.price);
    put('rooms', e.rooms);
    put('sqm', e.sqm);
    put('balconySqm', e.balconySqm);
    put('floor', e.floor);
    put('floorsInBuilding', e.floorsInBuilding);
    put('builtYear', e.builtYear);
    put('condition', e.condition);
    put('arnona', e.arnona);
    put('vaad', e.vaad);
    put('availableFrom', e.availableFrom);
    if (e.features.parking) next.parking = String(e.features.parking.value);

    const nextChecks: Record<string, boolean> = {};
    for (const [name, field] of Object.entries(e.features)) {
      if (name === 'parking' || field === undefined) continue;
      nextChecks[name] = Boolean(field.value);
    }

    setDraft(next);
    setChecks(nextChecks);
    if (e.deal) setDeal(e.deal.value);
    if (e.assetType) setAssetType(e.assetType.value);
    setLocation((prev) => ({
      ...prev,
      city: e.city?.value ?? prev.city,
      street: e.street?.value ?? prev.street,
      gush: e.gush ? String(e.gush.value) : prev.gush,
      helka: e.helka ? String(e.helka.value) : prev.helka,
    }));
    setFormKey((k) => k + 1);
    setStatus({ kind: 'idle', text: '' });
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    setIssues([]);
    setStatus({ kind: 'idle', text: '' });

    const form = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) body[k] = v;
    for (const [k] of CHECKBOXES) body[k] = form.get(k) === 'on';

    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        setStatus({ kind: 'ok', text: `הנכס נשמר (${json.property.id}). הוא כבר מופיע בחיפוש.` });
        ev.currentTarget.reset();
        setLocation({ city: '', street: '', gush: '', helka: '' });
        setDraft({});
        setChecks({});
        setFormKey((k) => k + 1);
      } else {
        setIssues(json.issues ?? []);
        setStatus({ kind: 'error', text: json.error ?? 'השמירה נכשלה' });
      }
    } catch {
      setStatus({ kind: 'error', text: 'לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PasteListing onExtracted={applyExtracted} />

      <div key={formKey} className="flex flex-col gap-4">
      <Section title="העסקה">
        <Field name="deal" label="סוג עסקה">
          <select id="deal" name="deal" className={field} value={deal} onChange={(e) => setDeal(e.target.value as 'sale' | 'rent')}>
            <option value="sale">מכירה</option>
            <option value="rent">שכירות</option>
          </select>
        </Field>
        <Field name="price" label={deal === 'sale' ? 'מחיר (₪)' : 'שכר דירה לחודש (₪)'}>
          <input id="price" name="price" type="number" required className={field} defaultValue={d('price')} />
          {issueFor('price') && <p className="mt-1 text-xs text-crit">{issueFor('price')}</p>}
        </Field>
        <Field name="source" label="מקור">
          <input id="source" name="source" className={field} defaultValue="קלט ישיר" />
        </Field>
        <Field name="publisherKind" label="מפרסם">
          <select id="publisherKind" name="publisherKind" className={field} defaultValue="private">
            <option value="private">פרטי</option>
            <option value="agency">תיווך</option>
          </select>
        </Field>
        <Field name="agentFeePct" label="דמי תיווך %">
          <input id="agentFeePct" name="agentFeePct" type="number" step="0.1" className={field} defaultValue="0" />
        </Field>
        <Field name="availableFrom" label="תאריך כניסה">
          <input id="availableFrom" name="availableFrom" className={field} defaultValue={d('availableFrom', 'מיידי')} />
        </Field>
      </Section>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display text-base font-bold">מיקום</legend>
        <p className="mb-3 text-xs text-muted">
          גוש וחלקה הם המפתח לכל מקור רשמי — בלעדיהם אי אפשר להצליב לנדל״ן, לטאבו או ל-GovMap. אפשר לאתר
          אותם מכתובת, או להזין ידנית.
        </p>
        <AddressLookup onResolved={(r) => setLocation((prev) => ({ ...prev, ...r }))} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Field name="city" label="עיר">
          <input
            id="city"
            name="city"
            required
            className={field}
            value={location.city}
            onChange={(e) => setLocation({ ...location, city: e.target.value })}
          />
          {issueFor('city') && <p className="mt-1 text-xs text-crit">{issueFor('city')}</p>}
        </Field>
        <Field name="neighborhood" label="שכונה">
          <input id="neighborhood" name="neighborhood" className={field} />
        </Field>
        <Field name="street" label="רחוב ומספר">
          <input
            id="street"
            name="street"
            className={field}
            value={location.street}
            onChange={(e) => setLocation({ ...location, street: e.target.value })}
          />
        </Field>
        <Field name="gush" label="גוש">
          <input
            id="gush"
            name="gush"
            type="number"
            required
            className={field}
            value={location.gush}
            onChange={(e) => setLocation({ ...location, gush: e.target.value })}
          />
          {issueFor('gush') && <p className="mt-1 text-xs text-crit">{issueFor('gush')}</p>}
        </Field>
        <Field name="helka" label="חלקה">
          <input
            id="helka"
            name="helka"
            type="number"
            required
            className={field}
            value={location.helka}
            onChange={(e) => setLocation({ ...location, helka: e.target.value })}
          />
          {issueFor('helka') && <p className="mt-1 text-xs text-crit">{issueFor('helka')}</p>}
        </Field>
        <Field name="tatHelka" label="תת־חלקה">
          <input id="tatHelka" name="tatHelka" type="number" className={field} />
        </Field>
        <Field name="walkTransitMin" label="הליכה לתחבורה (דק׳)">
          <input id="walkTransitMin" name="walkTransitMin" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="walkSchoolMin" label="הליכה לבי״ס (דק׳)">
          <input id="walkSchoolMin" name="walkSchoolMin" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="walkParkMin" label="הליכה לפארק (דק׳)">
          <input id="walkParkMin" name="walkParkMin" type="number" className={field} defaultValue="0" />
        </Field>
        </div>
      </fieldset>

      <Section title="הנכס">
        <Field name="assetType" label="סוג נכס">
          <select
            id="assetType"
            name="assetType"
            className={field}
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetType)}
          >
            {Object.entries(ASSET_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field name="rooms" label="חדרים">
          <input id="rooms" name="rooms" type="number" step="0.5" required className={field} defaultValue={d('rooms')} />
        </Field>
        <Field name="sqm" label="שטח בנוי (מ״ר)">
          <input id="sqm" name="sqm" type="number" required className={field} defaultValue={d('sqm')} />
          {issueFor('sqm') && <p className="mt-1 text-xs text-crit">{issueFor('sqm')}</p>}
        </Field>
        <Field name="balconySqm" label="מרפסת (מ״ר)">
          <input id="balconySqm" name="balconySqm" type="number" className={field} defaultValue={d('balconySqm', '0')} />
        </Field>
        <Field name="lotSqm" label="מגרש (מ״ר)">
          <input id="lotSqm" name="lotSqm" type="number" className={field} />
        </Field>
        <Field name="floor" label="קומה">
          <input id="floor" name="floor" type="number" className={field} defaultValue={d('floor', '0')} />
        </Field>
        <Field name="floorsInBuilding" label="מתוך קומות">
          <input id="floorsInBuilding" name="floorsInBuilding" type="number" className={field} defaultValue={d('floorsInBuilding', '1')} />
        </Field>
        <Field name="builtYear" label="שנת בנייה">
          <input id="builtYear" name="builtYear" type="number" required className={field} defaultValue={d('builtYear')} />
        </Field>
        <Field name="condition" label="מצב">
          <select id="condition" name="condition" className={field} defaultValue={d('condition', 'kept')}>
            <option value="new">חדש</option>
            <option value="renovated">משופץ</option>
            <option value="kept">שמור</option>
            <option value="needsWork">דורש שיפוץ</option>
          </select>
        </Field>
        <Field name="aspects" label="כיווני אוויר">
          <input id="aspects" name="aspects" className={field} />
        </Field>
        <Field name="parking" label="חניות">
          <input id="parking" name="parking" type="number" className={field} defaultValue={d('parking', '0')} />
        </Field>
        <Field name="ac" label="מיזוג">
          <input id="ac" name="ac" className={field} defaultValue="ללא" />
        </Field>
      </Section>

      <fieldset className="rounded-xl border border-line bg-surface p-4">
        <legend className="px-1 font-display text-base font-bold">מאפיינים</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {CHECKBOXES.map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm text-ink-2">
              <input
                id={name}
                name={name}
                type="checkbox"
                className="h-4 w-4 accent-accent"
                defaultChecked={checks[name] ?? false}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Section
        title="רישום ותכנון"
        hint="אם סטטוס לא ידוע — השאירו „לא ידוע”. ערך ריק מוצג בכרטיס כדגל, וזה נכון יותר מניחוש."
      >
        <Field name="registryKind" label="סוג רישום">
          <select id="registryKind" name="registryKind" className={field} defaultValue="tabu">
            <option value="tabu">טאבו</option>
            <option value="rmi">רמ״י</option>
            <option value="housingCompany">חברה משכנת</option>
          </select>
        </Field>
        <Field name="tenure" label="בעלות / חכירה">
          <select id="tenure" name="tenure" className={field} defaultValue="ownership">
            <option value="ownership">בעלות</option>
            <option value="lease">חכירה</option>
          </select>
        </Field>
        <Field name="leaseEndsAt" label="סיום חכירה">
          <input id="leaseEndsAt" name="leaseEndsAt" className={field} placeholder="2041" />
          {issueFor('leaseEndsAt') && <p className="mt-1 text-xs text-crit">{issueFor('leaseEndsAt')}</p>}
        </Field>
        <Field name="caveats" label="הערות אזהרה">
          <input id="caveats" name="caveats" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="mortgages" label="משכנתאות רשומות">
          <input id="mortgages" name="mortgages" type="number" className={field} defaultValue="0" />
        </Field>
        {assetType === 'housingUnit' && (
          <Field name="splitPermit" label="היתר פיצול">
            <select id="splitPermit" name="splitPermit" className={field} defaultValue="unknown">
              <option value="granted">קיים היתר</option>
              <option value="none">אין היתר</option>
              <option value="unknown">לא ידוע</option>
            </select>
            {issueFor('splitPermit') && <p className="mt-1 text-xs text-crit">{issueFor('splitPermit')}</p>}
          </Field>
        )}
        <Field name="urbanRenewal" label="התחדשות עירונית">
          <input id="urbanRenewal" name="urbanRenewal" className={field} placeholder="תמ״א 38/2" />
        </Field>
        <Field name="renewalStage" label="שלב ההליך">
          <input id="renewalStage" name="renewalStage" className={field} />
        </Field>
        <Field name="bettermentRisk" label="חשיפה להיטל השבחה">
          <select id="bettermentRisk" name="bettermentRisk" className={field} defaultValue="low">
            <option value="low">נמוכה</option>
            <option value="medium">בינונית</option>
            <option value="high">גבוהה</option>
          </select>
        </Field>
      </Section>

      <Section title="שוק ועלויות" hint="חציון האזור ושכר הדירה הצפוי מזינים את חישוב הפער והתשואה. בלעדיהם הכרטיס יציג „אין בסיס השוואה”.">
        <Field name="areaMedianPpsm" label="חציון אזורי למ״ר (₪)">
          <input id="areaMedianPpsm" name="areaMedianPpsm" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="areaMedianRent" label="שכ״ד אזורי (₪)">
          <input id="areaMedianRent" name="areaMedianRent" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="expectedMonthlyRent" label="שכ״ד צפוי (₪)">
          <input id="expectedMonthlyRent" name="expectedMonthlyRent" type="number" className={field} defaultValue="0" />
        </Field>
        <Field name="arnona" label="ארנונה לחודש (₪)">
          <input id="arnona" name="arnona" type="number" className={field} defaultValue={d('arnona', '0')} />
        </Field>
        <Field name="vaad" label="ועד בית (₪)">
          <input id="vaad" name="vaad" type="number" className={field} defaultValue={d('vaad', '0')} />
        </Field>
        <Field name="utilities" label="חשמל ומים (₪)">
          <input id="utilities" name="utilities" type="number" className={field} defaultValue="0" />
        </Field>
        {deal === 'rent' && (
          <>
            <Field name="depositMonths" label="פיקדון (חודשים)">
              <input id="depositMonths" name="depositMonths" type="number" step="0.5" max="3" className={field} defaultValue="2" />
            </Field>
            <Field name="minLeaseMonths" label="תקופה מינימלית (חודשים)">
              <input id="minLeaseMonths" name="minLeaseMonths" type="number" className={field} defaultValue="12" />
            </Field>
          </>
        )}
      </Section>

      </div>

      {status.kind !== 'idle' && (
        <p
          role="status"
          className={`rounded-lg px-4 py-3 text-sm font-semibold ${
            status.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-crit-soft text-crit'
          }`}
        >
          {status.text}
          {issues.length > 0 && (
            <span className="mt-1 block font-normal">
              {issues.map((i) => `${i.path[0]}: ${i.message}`).join(' · ')}
            </span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {busy ? 'שומר…' : 'שמירת הנכס'}
        </button>
        <span className="text-xs text-muted">
          עמודות לייבוא CSV: <span className="font-mono">{CSV_COLUMNS.join(', ')}</span>
        </span>
      </div>
    </form>
  );
}
