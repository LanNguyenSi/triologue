export interface IoLike {
  to(room: string): { emit(event: string, data: unknown): void };
}
