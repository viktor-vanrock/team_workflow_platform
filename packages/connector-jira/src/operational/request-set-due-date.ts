export function mapJiraDueDate(input: Readonly<{ value?: string; clear?: boolean }>) {
  if (input.clear === true) {
    if (input.value) throw new Error("DUE_DATE_INPUT_CONFLICT");
    return Object.freeze({ fields: Object.freeze({ duedate: null }) });
  }
  if (!input.value || !/^\d{4}-\d{2}-\d{2}$/u.test(input.value))
    throw new Error("DUE_DATE_INVALID");
  return Object.freeze({ fields: Object.freeze({ duedate: input.value }) });
}
