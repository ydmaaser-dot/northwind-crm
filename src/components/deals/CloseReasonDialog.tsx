import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  stage: "Won" | "Lost" | null;
  dealTitle?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
};

export default function CloseReasonDialog({ stage, dealTitle, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (stage) setReason("");
  }, [stage]);

  const confirm = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    await onConfirm(reason.trim());
    setSaving(false);
  };

  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Mark as {stage}</DialogTitle>
          <DialogDescription>{dealTitle ? `“${dealTitle}”: ` : ""}say why, so the team can learn from it.</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="close-reason">Why was it {stage?.toLowerCase()}?</Label>
          <Textarea
            id="close-reason"
            rows={3}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-xl"
            placeholder={stage === "Won" ? "Best price and fast delivery" : "Went with a cheaper supplier"}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full" onClick={onCancel}>Cancel</Button>
          <Button className="rounded-full" disabled={saving || !reason.trim()} onClick={confirm}>{saving ? "Saving…" : `Mark as ${stage}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
