// Small helpers for the HR routes.
export function csvOut(csv: string, filename = 'staff.csv'): Response {
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
}
