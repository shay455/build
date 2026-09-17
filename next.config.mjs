/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@libsql/client'],

  /**
   * The report route reads the vendored font from disk at request time, through a
   * path built with resolve(). Next's dependency tracing follows imports, not
   * computed filesystem reads, so without this the font is absent from the
   * serverless bundle and PDF generation fails in production only.
   */
  outputFileTracingIncludes: {
    '/api/report/[id]': ['./assets/fonts/*.ttf'],
  },
};
export default nextConfig;
