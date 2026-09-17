import { AddPropertyForm } from '@/components/AddPropertyForm';
import { countProperties } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AddPage() {
  const total = await countProperties();

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="font-display text-3xl font-black">הוספת נכס</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          ערוץ הקלט הישיר: מתווך או בעל נכס מזין מלאי בלי תלות בלוח מודעות. במאגר כרגע {total} נכסים.
          שדות מחושבים — מס רכישה, תשואה, פער מול האזור — אינם נקלטים כאן; הם נגזרים בזמן ריצה.
        </p>
      </section>
      <AddPropertyForm />
      <p className="text-xs leading-relaxed text-muted">
        לייבוא מרובה: <span className="font-mono">POST /api/import</span> עם גוף CSV. שורות תקינות נקלטות
        ושורות פסולות מדווחות לפי מספר שורה, כדי שטעות אחת לא תפיל קובץ שלם.
      </p>
    </div>
  );
}
