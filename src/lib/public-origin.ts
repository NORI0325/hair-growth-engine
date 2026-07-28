export const PUBLIC_APP_ORIGIN = "https://saronboost.com";

export const publicAppUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_APP_ORIGIN}${normalizedPath}`;
};
