/** One entry of a command's `arguments`, as far as `contextOf` reads it. */
interface ArgumentEntry {
  readonly field: string;
  readonly complete: string;
  readonly of?: string;
  readonly meaning?: string;
}
/** Sources that read an earlier field, and the sources that field may have. */
export declare const CONTEXT: Readonly<Record<string, readonly string[]>>;
/** The field the argument at `at` reads: `of`, else the nearest earlier fitting field without a meaning. */
export declare const contextOf: (args: readonly ArgumentEntry[], at: number) => string | undefined;
/** The most words a summary has. */
export declare const SUMMARY_WORDS: number;
/** The error lines of the checks of the command catalog that JSON Schema cannot express. */
export declare function checkCatalog(
  catalog: { readonly commands: readonly unknown[] },
  schemas?: Readonly<Record<string, unknown>>,
): string[];
