export async function readAllPages<T>(
  pageQuery: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 500,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const data: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const page = await pageQuery(start, start + pageSize - 1);
    if (page.error) return { data: [], error: page.error };
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) return { data, error: null };
  }
}
