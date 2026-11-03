// Per-document gate. A waiting worker acquires this only after the UI is idle.
let owner = "",
  expires = 0,
  operations = 0;
export const updateLocked = () => !!owner && Date.now() < expires;
export function lockUpdate(id: string) {
  if (operations || updateLocked()) return false;
  owner = id;
  expires = Date.now() + 15000;
  return true;
}
export function unlockUpdate(id: string) {
  if (owner === id) {
    owner = "";
    expires = 0;
  }
}
export function beginStorageOperation() {
  if (updateLocked()) throw Error("update_in_progress");
  operations++;
  return () => {
    operations--;
  };
}
