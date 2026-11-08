import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { useAuthFileUrl } from "../../lib/fileUrl";

type AuthFileLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Stored path, e.g. `/uploads/abc.pdf`. */
  url: string;
};

/** `<a>` to an uploaded file; the href carries a short-lived file token and is refreshed before it expires. */
export function AuthFileLink({ url, children, ...rest }: AuthFileLinkProps) {
  const { href } = useAuthFileUrl(url, { proactive: true });
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

type AuthFileImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  url: string;
};

/** `<img>` of an uploaded file; renders once a token is available and re-mints it when the load fails (expired URL). */
export function AuthFileImage({ url, onError, alt = "", ...rest }: AuthFileImageProps) {
  const { href, refresh } = useAuthFileUrl(url);
  if (!href) return null;
  return (
    <img
      {...rest}
      alt={alt}
      src={href}
      onError={(event) => {
        refresh();
        onError?.(event);
      }}
    />
  );
}
