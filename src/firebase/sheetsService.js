// ── Google Sheets Export Service ─────────────────────────────────────
// Creates monthly spreadsheets and daily tab-sheets with full day reports
// Uses Google Sheets API v4 via REST (no server-side SDK needed)
//
// Structure:
//   Spreadsheet: "Ledgero_সেপ্টেম্বর_2026"
//     └── Tab: "Day-05 (শনি)" — full daily report

import { saveSheetsConfig, loadSheetsConfig } from './firestoreService.js';
import { calcItemSummary } from '../data/calculations.js';

export function sanitizeSpreadsheetCell(value) {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── Bengali Month Names ─────────────────────────────────────────────
const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const BN_DAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helper: Make API Request (with 429/503 Exponential Backoff) ─────

async function sheetsRequest(url, token, options = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.ok) {
      return res.json();
    }

    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const delayMs = Math.pow(2, attempt) * 500;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    const errBody = await res.json().catch(() => ({}));
    console.error('Sheets API Error:', res.status, errBody);
    throw new Error(errBody.error?.message || `Sheets API error: ${res.status}`);
  }
}

export function formatSheetTxType(type) {
  const labels = {
    stock_sale: 'পণ্য বিক্রি (Stock Sale)',
    cash_sale: 'নগদ বিক্রি (Cash Sale)',
    stock_purchase: 'পণ্য ক্রয় (Stock Purchase)',
    quick_restock: 'দ্রুত স্টক যোগ (Quick Restock)',
    expense: 'খরচ (Expense)',
    baki_received: 'বাকি আদায় (Due Collected)',
    loan_collected: 'বাকি আদায় (Due Collected)',
    loan_given: 'বাকি দেওয়া (Due Given)',
    loan_taken: 'মহাজন বাকি (Supplier Credit)',
    loan_repaid: 'মহাজন পরিশোধ (Supplier Paid)',
    service_income: 'সার্ভিস আয় (Service Income)',
    recharge: 'রিচার্জ (Recharge)',
    damage_loss: 'ক্ষতি/নষ্ট (Damage Loss)',
    stock_damage: 'স্টক নষ্ট (Stock Damage)',
    personal_draw: 'মালিক উত্তোলন (Personal Draw)',
    owner_took: 'মালিক নিল (Owner Took)',
    owner_gave: 'মালিক দিল (Owner Gave)',
    cash_in: 'নগদ জমা (Cash In)',
    cash_out: 'নগদ প্রদান (Cash Out)',
    cash_adjustment: 'নগদ সমন্বয় (Cash Adjustment)',
  };
  return labels[type] || type || '';
}

// ── Get or Create Monthly Spreadsheet ───────────────────────────────

export async function getOrCreateMonthlySpreadsheet(token, userId, shopName, dateKey) {
  const [year, monthStr] = dateKey.split('-');
  const monthIndex = parseInt(monthStr, 10) - 1;
  const monthKey = `${year}-${monthStr}`;
  
  const bnMonth = BN_MONTHS[monthIndex];
  const enMonth = EN_MONTHS[monthIndex];
  const safeShopName = sanitizeSpreadsheetCell(shopName);
  const spreadsheetTitle = `Ledgero_${safeShopName}_${bnMonth}_${year}`;

  // Check if we already have a spreadsheet ID for this month
  const sheetsConfig = await loadSheetsConfig(userId);
  const existingId = sheetsConfig?.monthlySpreadsheets?.[monthKey] || sheetsConfig?.[monthKey];
  
  if (existingId) {
    // Verify it still exists
    try {
      await sheetsRequest(`${SHEETS_API}/${existingId}?fields=spreadsheetId`, token);
      return existingId;
    } catch {
      // Spreadsheet was deleted, create a new one
    }
  }

  // Create new spreadsheet
  const createBody = {
    properties: {
      title: spreadsheetTitle,
    },
    sheets: [{
      properties: {
        title: 'সূচী (Index)',
        gridProperties: { rowCount: 50, columnCount: 10 },
        tabColor: { red: 0.1, green: 0.5, blue: 0.8 }
      }
    }]
  };

  const created = await sheetsRequest(SHEETS_API, token, {
    method: 'POST',
    body: JSON.stringify(createBody),
  });

  const spreadsheetId = created.spreadsheetId;

  // Write index header (all cells sanitized against formula injection)
  const indexHeaderRows = [
    [`📊 ${shopName} — ${bnMonth} ${year} (${enMonth} ${year})`],
    ['Ledgero দৈনিক হিসাব রিপোর্ট'],
    [`তৈরি: ${new Date().toLocaleDateString('bn-BD')}`],
    ['দিন', 'তারিখ', 'নেট লাভ (৳)', 'মোট সম্পদ (৳)']
  ].map(row => row.map(val => sanitizeSpreadsheetCell(val)));

  await sheetsRequest(
    `${SHEETS_API}/${spreadsheetId}/values/সূচী (Index)!A1:D4?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: indexHeaderRows
      })
    }
  );

  // Bold index header
  try {
    const spreadsheet = await sheetsRequest(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, token);
    const indexSheet = spreadsheet.sheets?.find(s => s.properties?.title === 'সূচী (Index)');
    const sheetId = indexSheet?.properties?.sheetId;
    if (sheetId != null) {
      await sheetsRequest(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            { repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
              cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
              fields: 'userEnteredFormat.textFormat'
            }},
            { repeatCell: {
              range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 10 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.94, blue: 0.99 } } },
              fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }},
            { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 10 } } }
          ]
        })
      });
    }
  } catch (e) { console.warn('Index formatting skip:', e); }

  // Save spreadsheet ID to Firestore under structured monthlySpreadsheets map
  const existingMap = (sheetsConfig?.monthlySpreadsheets && typeof sheetsConfig.monthlySpreadsheets === 'object')
    ? sheetsConfig.monthlySpreadsheets
    : {};
  await saveSheetsConfig(userId, {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    lastSync: new Date().toISOString(),
    monthlySpreadsheets: {
      ...existingMap,
      [monthKey]: spreadsheetId,
    },
  });

  return spreadsheetId;
}

// ── Export Day Data to Sheet Tab ────────────────────────────────────

export async function exportDayToSheet(token, userId, spreadsheetId, dayData, bizInfo, lang = 'bn') {
  const { dateKey, wallets, inventory, transactions, loans, services, actualCash, cashMismatch } = dayData;
  
  const [, , dayStr] = dateKey.split('-');
  const dayNum = parseInt(dayStr, 10);
  const dateObj = new Date(dateKey + 'T00:00:00');
  const dayOfWeek = dateObj.getDay();
  const dayName = lang === 'bn' ? BN_DAYS[dayOfWeek] : EN_DAYS[dayOfWeek];
  
  const tabTitle = `Day-${String(dayNum).padStart(2, '0')} (${dayName})`;
  const shopName = bizInfo?.name || 'Ledgero';

  // 1. Add new sheet tab
  try {
    await sheetsRequest(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          addSheet: {
            properties: {
              title: tabTitle,
              gridProperties: { rowCount: 200, columnCount: 12 },
              tabColor: { red: 0.15, green: 0.65, blue: 0.35 }
            }
          }
        }]
      })
    });
  } catch (err) {
    // Tab might already exist — clear and rewrite
    if (err.message?.includes('already exists')) {
      await sheetsRequest(
        `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabTitle)}!A1:L200:clear`,
        token,
        { method: 'POST', body: '{}' }
      );
    } else {
      throw err;
    }
  }

  // 2. Build rows
  const rows = [];
  const dateDisplay = new Date(dateKey + 'T00:00:00').toLocaleDateString(
    lang === 'bn' ? 'bn-BD' : 'en-US', 
    { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
  );

  // Header
  rows.push([`📊 ${shopName}`]);
  rows.push([`📅 ${dateDisplay}`]);
  rows.push([]); // spacer

  // ── Wallet Balances ───────────────────────────────────────────
  rows.push(['💰 WALLET BALANCES', '', '', '']);
  rows.push(['Wallet', 'Opening (৳)', 'Current (৳)', 'Closing (৳)']);
  
  if (wallets) {
    const walletKeys = wallets._order || Object.keys(wallets).filter(k => k !== '_order');
    walletKeys.forEach(key => {
      const w = wallets[key];
      if (!w) return;
      const name = w.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      rows.push([name, w.opening || 0, w.current || 0, w.closing || w.current || 0]);
    });
  }
  rows.push([]); // spacer

  // ── Inventory Summary ─────────────────────────────────────────
  rows.push(['📦 INVENTORY SUMMARY', '', '', '', '', '', '', '']);
  rows.push(['Product', 'Unit', 'Buy (৳)', 'Sell (৳)', 'Opening', 'Added', 'Closing', 'Sold', 'Revenue (৳)', 'COGS (৳)', 'Profit (৳)']);
  
  let totalRevenue = 0, totalCOGS = 0, totalProfit = 0;
  if (inventory?.length) {
    inventory.forEach(item => {
      const { sold, revenue: rev, cost: cogs, profit } = calcItemSummary(item);
      totalRevenue += rev;
      totalCOGS += cogs;
      totalProfit += profit;
      rows.push([
        item.name, item.unit || 'পিস', 
        item.buyPrice || 0, item.sellPrice || 0,
        item.openingStock || 0, item.addedStock || 0, item.closingStock || 0,
        sold, rev, cogs, profit
      ]);
    });
  }
  rows.push(['TOTAL', '', '', '', '', '', '', '', totalRevenue, totalCOGS, totalProfit]);
  rows.push([]); // spacer

  // ── Transactions ──────────────────────────────────────────────
  rows.push(['📋 TRANSACTIONS', '', '', '', '', '']);
  rows.push(['Time', 'Type', 'Amount (৳)', 'Note', 'From', 'To', 'Customer']);
  
  let totalExpense = 0, totalDraw = 0, serviceIncome = 0, totalDamageLoss = 0;
  const activeTransactions = (transactions || []).filter(tx => !tx.reversed && !tx.isReversal);
  if (activeTransactions.length) {
    activeTransactions.forEach(tx => {
      const time = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString(
        lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true }
      ) : '';
      rows.push([
        time, formatSheetTxType(tx.type), tx.amount || 0, tx.note || '',
        tx.fromWallet?.replace(/_/g, ' ') || '', 
        tx.toWallet?.replace(/_/g, ' ') || '',
        tx.customerName || ''
      ]);
      if (tx.type === 'expense') totalExpense += (tx.amount || 0);
      if (tx.type === 'personal_draw' || tx.type === 'owner_took') totalDraw += (tx.amount || 0);
      if (tx.type === 'service_income') serviceIncome += (tx.amount || 0);
      if (tx.type === 'damage_loss' || tx.type === 'stock_damage') totalDamageLoss += (tx.amount || 0);
    });
  }
  rows.push([]); // spacer

  // ── Profit & Loss ─────────────────────────────────────────────
  const rechargeProfit = activeTransactions.filter(tx => tx.type === 'recharge').reduce((sum, tx) => sum + (tx.profit || 0), 0) || 0;
  const svcPhotocopy = services?.photocopy || 0;
  const svcStudio = services?.studio || 0;
  const grossProfit = totalProfit + rechargeProfit + serviceIncome + svcPhotocopy + svcStudio;
  const netProfit = grossProfit - totalExpense - totalDamageLoss - totalDraw;

  rows.push(['💵 PROFIT & LOSS', '', '']);
  rows.push(['Item', 'Amount (৳)']);
  rows.push(['Sales Revenue', totalRevenue]);
  rows.push(['Cost of Goods Sold (COGS)', totalCOGS]);
  rows.push(['Product Profit', totalProfit]);
  rows.push(['Recharge Profit', rechargeProfit]);
  rows.push(['Service Income (Photocopy)', svcPhotocopy]);
  rows.push(['Service Income (Studio)', svcStudio]);
  rows.push(['Service Income (Other)', serviceIncome]);
  rows.push(['Total Expenses', -totalExpense]);
  if (totalDamageLoss > 0) {
    rows.push(['Damage / Loss', -totalDamageLoss]);
  }
  rows.push(['Personal Draw / Owner Took', -totalDraw]);
  rows.push(['═══════════════════════', '']);
  rows.push(['NET PROFIT', netProfit]);
  rows.push([]); // spacer

  // ── Cash Reconciliation ───────────────────────────────────────
  const expectedCash = wallets?.hand_cash?.current || 0;
  rows.push(['🏦 CASH RECONCILIATION', '', '']);
  rows.push(['Item', 'Amount (৳)']);
  rows.push(['Expected Cash in Drawer', expectedCash]);
  rows.push(['Actual Cash Counted', actualCash ?? 'N/A']);
  rows.push(['Cash Mismatch', cashMismatch ?? 0]);
  rows.push([]); // spacer

  // ── Loans & Debts ─────────────────────────────────────────────
  rows.push(['📊 LOANS & DEBTS (ধার-দেনা)', '', '', '']);
  rows.push(['Item', 'Opening (৳)', 'Closing (৳)']);
  rows.push(['Market Due (মহাজনকে দেবো)', loans?.openingTaken || 0, loans?.closingTaken || loans?.openingTaken || 0]);
  rows.push(['Customer Due (বাকি পাবো)', loans?.openingGiven || 0, loans?.closingGiven || loans?.openingGiven || 0]);
  rows.push([]); // spacer

  // ── Tea House ─────────────────────────────────────────────────
  const teaEntries = dayData.teaHouseEntries || [];
  const teaDayPersonal = dayData.teaHouseDayPersonal || 0;
  const teaDayShop = dayData.teaHouseDayShop || 0;
  const teaMonthlyTab = dayData.teaHouseMonthlyTab || 0;
  
  if (teaEntries.length > 0 || teaDayPersonal > 0 || teaDayShop > 0) {
    rows.push(['☕ TEA HOUSE (টি-হাউস)', '', '', '', '', '']);
    rows.push(['Time', 'Item', 'Qty', 'Price (৳)', 'Total (৳)', 'Type']);
    
    teaEntries.forEach(entry => {
      const time = new Date(entry.timestamp);
      const h = time.getHours() % 12 || 12;
      const m = time.getMinutes().toString().padStart(2, '0');
      const ampm = time.getHours() >= 12 ? 'PM' : 'AM';
      rows.push([
        `${h}:${m} ${ampm}`,
        entry.itemName,
        entry.qty,
        entry.price,
        entry.total,
        entry.type === 'personal' ? 'নিজের (Personal)' : 'দোকান (Shop)'
      ]);
    });
    
    rows.push(['═══════════════════════', '', '', '', '', '']);
    rows.push(['Personal (নিজের)', '', '', '', teaDayPersonal, '']);
    rows.push(['Shop (দোকানের)', '', '', '', teaDayShop, '']);
    rows.push(['Total Today', '', '', '', teaDayPersonal + teaDayShop, '']);
    rows.push(['Monthly Tab (মাসিক বাকি)', '', '', '', teaMonthlyTab, '']);
  }

  // 3. Write all rows to the sheet
  const sanitizedRows = rows.map(row => row.map(val => sanitizeSpreadsheetCell(val)));
  await sheetsRequest(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabTitle)}!A1:L${sanitizedRows.length}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ values: sanitizedRows })
    }
  );

  // 4. Apply basic formatting (bold headers, column widths)
  try {
    const spreadsheet = await sheetsRequest(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, token);
    const targetSheet = spreadsheet.sheets?.find(s => s.properties?.title === tabTitle);
    const sheetId = targetSheet?.properties?.sheetId;

    if (sheetId != null) {
      await sheetsRequest(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            // Auto-resize columns
            { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 12 } } },
            // Bold the header row
            { repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 },
              cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
              fields: 'userEnteredFormat.textFormat'
            }},
          ]
        })
      });
    }
  } catch (fmtErr) {
    console.warn('Sheet formatting warning:', fmtErr);
  }

  // 5. Update Index sheet with this day's summary
  try {
    let totalWealth = 0;
    if (wallets) {
      Object.entries(wallets).forEach(([key, w]) => {
        if (key !== '_order' && w) totalWealth += (w.closing || w.current || 0);
      });
    }

    // Find next empty row in index
    const indexData = await sheetsRequest(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('সূচী (Index)')}!A:A`,
      token
    );
    const nextRow = (indexData.values?.length || 4) + 1;

    await sheetsRequest(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('সূচী (Index)')}!A${nextRow}:D${nextRow}?valueInputOption=RAW`,
      token,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [[tabTitle, dateKey, netProfit, totalWealth].map(val => sanitizeSpreadsheetCell(val))]
        })
      }
    );
  } catch (idxErr) {
    console.warn('Index update warning:', idxErr);
  }

  return tabTitle;
}

// ── Main Export Function (called from Closing Screen) ───────────────

export async function exportToGoogleSheets(token, userId, dayData, bizInfo, lang = 'bn') {
  const shopName = bizInfo?.name || 'Ledgero';
  
  // 1. Get or create the monthly spreadsheet
  const spreadsheetId = await getOrCreateMonthlySpreadsheet(token, userId, shopName, dayData.dateKey);
  
  // 2. Export day data to a new tab
  const tabTitle = await exportDayToSheet(token, userId, spreadsheetId, dayData, bizInfo, lang);
  
  // 3. Return info for success message
  return {
    spreadsheetId,
    tabTitle,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
  };
}
