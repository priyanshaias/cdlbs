// TEMPLATE. Copy to Config.local.gs, fill in, and paste it into Apps Script as a second file (Config.local) in the CDL+BS Apps Script project.
// Kept out of GitHub (.gitignore).
const LOCAL_CONFIG = {
  SHEET_ID: '',   // the ID of the CDL+BS Google Sheet made from the import workbook (the long part of its link)
  // Built-in accounts (admins and shared operators). Division users sign up themselves and are kept in the Users tab.
  // password: plain text. (Accounts copied from UPMC / FV have salt + hash instead; both work.)
  // Once an admin sets a password on the Users page, that one is used and shown there.
  ACCOUNTS: {
    // username: { role: 'admin' or 'operator', name: 'Shown name', password: 'something' },
  },
};
