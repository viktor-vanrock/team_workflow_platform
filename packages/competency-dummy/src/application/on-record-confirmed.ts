import type {
  ConfirmationHookInput,
  ConfirmationTransaction,
  TransactionAwareConfirmationHook,
} from "@awp/competency-sdk";

export interface DummyConfirmationWriter {
  link(transaction: ConfirmationTransaction, input: ConfirmationHookInput): Promise<void>;
}
export class OnSampleRecordConfirmed implements TransactionAwareConfirmationHook {
  readonly componentRef = "dummy.on-sample-record-confirmed";
  constructor(private readonly writer: DummyConfirmationWriter) {}
  confirm(transaction: ConfirmationTransaction, input: ConfirmationHookInput): Promise<void> {
    return this.writer.link(transaction, input);
  }
}
