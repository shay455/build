import { EnrichButton } from '@/components/EnrichButton';
import { SearchApp } from '@/components/SearchApp';
import { listCities, listProperties } from '@/lib/db';
import { resolveSource } from '@/lib/sources';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [properties, cities] = await Promise.all([listProperties(), listCities()]);
  const source = resolveSource();
  const enriched = properties.filter((p) => p.marketStatus !== 'manual').length;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="font-display text-3xl font-black sm:text-4xl">כל מה שצריך להחלטה, בכרטיס אחד</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          כתבו מה אתם מחפשים בשפה חופשית. הסוכן מפרש, מסנן, מדרג ומסביר — ומחשב לכל נכס את מס הרכישה לפי
          הפרופיל שלכם, את ההון העצמי הנדרש, את התשואה ואת העלות החודשית המלאה.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <EnrichButton />
          <p className="text-xs text-muted">
            מקור נתוני שוק: {source.label} · {enriched} מתוך {properties.length} נכסים נשלפו ממקור, השאר הוזנו ידנית
          </p>
        </div>
      </section>

      <SearchApp properties={properties} cities={cities} />
    </div>
  );
}
