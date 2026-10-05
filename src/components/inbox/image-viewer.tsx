"use client";

import { Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

interface Props {
  /** Image to show (an object URL or a public URL). */
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full-size image with "open in new tab" and "download". */
export function ImageViewer({ src, alt, open, onOpenChange }: Props) {
  const t = useTranslations("Inbox.bubble");

  async function download() {
    try {
      // Works for object URLs and for public URLs that allow CORS.
      const res = await fetch(src);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const ext = EXTENSION_BY_TYPE[blob.type] ?? "jpg";
      saveBlob(blob, `image-${Date.now()}.${ext}`);
    } catch {
      toast.error(t("downloadFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-h-[92vh] max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">{t("imageViewer")}</DialogTitle>
        <div className="flex items-center gap-2 pr-9">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="h-4 w-4" />
            {t("openInNewTab")}
          </a>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="h-4 w-4" />
            {t("download")}
          </Button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
