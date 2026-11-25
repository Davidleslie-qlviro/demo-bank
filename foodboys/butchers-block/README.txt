FOOD BOYS BUTCHERS BLOCK - standalone version
=============================================
One file: index.html. No build step, no server needed.

TO RUN
- Double-click index.html to try it, or upload it to any web host
  (Vercel, Netlify, cPanel, the existing Food Boys site) and open the link.
- On a phone: open the link, then "Add to Home Screen".

WHAT IT DOES
Receive a carcass -> Break down (type or say the cuts) -> Sell -> Count -> Books (journals, CSV).
Setup holds the cuts, selling prices (incl VAT) and expected yields.
Prices and yields shipped in it are placeholders. Replace with Food Boys' real figures under Setup.

WHERE DATA LIVES
Saved in the browser on the device being used (localStorage). It is NOT shared between devices.
Setup > Backup downloads a JSON file, and restores it on another device.
Setup > Backup > Clear all test data empties the carcasses, sales and stock takes (cuts, prices and yields are kept).

FOR THE IT TEAM
- All storage goes through makeDb() near the top of the script. To share data between devices,
  replace it with calls to a server or database. Same four collections:
  products, templates, lots, moves.
- Journals use placeholder account names (ACC constant). Map to the Pastel chart of accounts.
- VAT is set at 15% (VAT constant).
- The AI features of the claude.ai test version (ask your books, read an invoice) are not included.
  Till import is simple: one line per cut with the mass in kg.
