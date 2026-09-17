import { SearchApp } from '@/components/SearchApp';
import { listCities, listProperties } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const properties = listProperties();
  const cities = listCities();

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="font-display text-3xl font-black sm:text-4xl">כל מה שצריך להחלטה, בכרטיס אחד</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          כתבו מה אתם מחפשים בשפה חופשית. הסוכן מפרש, מסנן, מדרג ומסביר — ומחשב לכל נכס את מס הרכישה לפי
          הפרופיל שלכם, את ההון העצמי הנדרש, את התשואה ואת העלות החודשית המלאה.
        </p>
      </section>

      <SearchApp properties={properties} cities={cities} />
    </div>
  );
}
