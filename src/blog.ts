// Distinguishes generated category indexes from authored articles on repeated builds.
export const CATEGORY_METADATA = 'blog_category: true';

export function postCategories(
  directory: string,
): {name: string; directory: string}[] {
  const parts = directory.split('/').slice(0, -1);

  return parts.map((name, index) => ({
    name,
    directory: parts.slice(0, index + 1).join('/'),
  }));
}
