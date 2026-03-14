export default class Database {
  static async load(_path: string): Promise<Database> {
    return new Database()
  }
  async execute(_query: string, _values?: unknown[]): Promise<void> {}
  async select<T>(_query: string, _values?: unknown[]): Promise<T> {
    return [] as unknown as T
  }
}
