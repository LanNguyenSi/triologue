export async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(String(body?.error || fallback));
}
