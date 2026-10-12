// Profile "Picture" (SPEC BR-02): "Upload picture" opens the square crop dialog, the browser resizes the crop to
// 256 by 256 and uploads it at once; "Remove" (after a confirmation) goes back to the initials. The picture shows on
// the landing and booking pages, in emails and in the app.
"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { toast } from "@/components/ui/toast";
import { removeImageAction } from "@/lib/settings/actions";
import { AVATAR_HINT, AVATAR_SIZE, IMAGE_ACCEPT, IMAGE_MAX_BYTES } from "@/lib/settings/schemas";
import { uploadSettingsImage } from "./upload-image";

export type AvatarFieldProps = {
  /** The current picture (uploaded avatar or provider picture), or null for initials. */
  initialUrl: string | null;
};

export function AvatarField({ initialUrl }: AvatarFieldProps) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [url, setUrl] = useState(initialUrl);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex min-w-0 flex-col gap-2">
      <p id={`${id}-label`} className="text-label text-ink">
        Picture
      </p>
      <FileUpload
        id={`${id}-file`}
        value={url}
        crop="square"
        outputSize={AVATAR_SIZE}
        accept={IMAGE_ACCEPT}
        maxBytes={IMAGE_MAX_BYTES}
        label={url ? "Change picture" : "Upload picture"}
        hint={AVATAR_HINT}
        previewShape="circle"
        loading={removing}
        onFile={async (file) => {
          const saved = await uploadSettingsImage("avatar", file);
          setUrl(saved.url);
          toast.success("Profile picture updated");
          router.refresh();
        }}
        onRemove={() => setConfirmRemove(true)}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove profile picture?"
        description="Your initials will show instead on your booking pages, in emails and in the app."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={async () => {
          setRemoving(true);
          try {
            const res = await removeImageAction({ kind: "avatar" });
            // ConfirmDialog keeps the dialog open and shows the message as a toast.
            if (!res.ok) throw new Error(res.error.message);
            setUrl(null);
            toast.success("Profile picture removed");
            router.refresh();
          } finally {
            setRemoving(false);
          }
        }}
      />
    </div>
  );
}
