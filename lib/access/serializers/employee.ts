import { can, type AccessUser } from '@/lib/access-core';
import { maskTail, omit, pick, type Row } from './mask';

/** What the staff directory shows everyone: name, title, department, work phone. */
const DIRECTORY = ['id', 'employeeNo', 'title', 'firstName', 'surname', 'jobTitle', 'departmentId', 'department', 'workPhone', 'photoKey', 'status', 'category'];
/** ID numbers, home address, next of kin ... (hr.employees.view, or the person's own record). */
const PERSONAL = ['nationalId', 'dateOfBirth', 'gender', 'maritalStatus', 'nationality', 'homeAddress', 'personalPhone', 'personalEmail', 'nextOfKin', 'qualifications', 'documents', 'history'];
/** Salary, bank details, tax and NSSA numbers, medical notes (hr.pay.view). */
const PAY = ['pay', 'components', 'salary', 'basicCents', 'bankName', 'bankBranch', 'bankAccountNo', 'accountNumber', 'zimraTaxNo', 'nssaNo', 'medicalNotes', 'loans'];
/** Disciplinary records (hr.discipline.view). */
const DISCIPLINE = ['discipline', 'disciplineCases'];
/** Never leave the server. */
const SECRETS = ['tabletPinHash', 'passwordHash'];

const isOwnRecord = (user: AccessUser, e: Row) => !!e.userId && e.userId === user.id;

/**
 * A staff record for the browser. Everyone with hr.directory.view gets the directory fields; the rest needs its own key:
 * hr.employees.view for IDs, address and next of kin; hr.pay.view for pay, bank, tax and NSSA numbers; hr.discipline.view for
 * disciplinary records. A person always sees their own record, with tax and NSSA numbers cut to their last 4 characters.
 */
export function serializeEmployee(user: AccessUser, employee: Row): Row {
  const own = isOwnRecord(user, employee);
  const wantsPersonal = own || can(user, 'hr.employees.view');
  if (!own && !wantsPersonal && !can(user, 'hr.directory.view')) return {};
  let out: Row = pick(employee, DIRECTORY);
  if (wantsPersonal) out = { ...out, ...pick(employee, PERSONAL) };
  if (can(user, 'hr.pay.view')) out = { ...out, ...pick(employee, PAY) };
  else if (own) out = { ...out, ...ownPay(pick(employee, PAY)) };
  if (can(user, 'hr.discipline.view')) out = { ...out, ...pick(employee, DISCIPLINE) };
  return omit(out, SECRETS);
}

/** The employee's own pay data: figures stay, tax and NSSA numbers show their last 4 characters, the bank account number is left out. */
function ownPay(pay: Row): Row {
  const cut = (r: Row): Row => {
    const o: Row = { ...r };
    for (const f of ['zimraTaxNo', 'nssaNo']) if (f in o) o[f] = maskTail(o[f], 4);
    return omit(o, ['bankAccountNo', 'accountNumber']);
  };
  const out = cut(pay);
  if (out.pay && typeof out.pay === 'object') out.pay = cut(out.pay as Row);
  return out;
}

/** A payslip: the employee's own, or anyone's for a person who holds hr.pay.view. Otherwise null. Tax and NSSA numbers: last 4 only. */
export function serializePayslip(user: AccessUser, payslip: Row, ownerUserId: string | null): Row | null {
  const own = !!ownerUserId && ownerUserId === user.id;
  if (!own && !can(user, 'hr.pay.view')) return null;
  const out: Row = { ...payslip };
  for (const f of ['zimraTaxNo', 'nssaNo', 'taxNumber', 'nssaNumber']) if (f in out) out[f] = maskTail(out[f], 4);
  return out;
}
