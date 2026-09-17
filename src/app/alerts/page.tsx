import { AlertsBoard } from '@/components/AlertsBoard';

export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="font-display text-3xl font-black">חיפושים שמורים</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          כל חיפוש שמור הוא מנדט: מה מחפשים, לפי איזה פרופיל קונה, ומאיזה ציון ומעלה שווה להפריע לכם.
          הבדיקה מדווחת <b>מה השתנה</b> — ירידת מחיר, נכס חדש שעונה על התנאים, או התאמה שהשתפרה — ולא
          מרשימה מחדש את מה שכבר ראיתם.
        </p>
      </section>
      <AlertsBoard />
    </div>
  );
}
