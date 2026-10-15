/**
 * Ledgero — Google Sheets Auto-Export Apps Script
 * 
 * এই স্ক্রিপ্ট Ledgero অ্যাপ থেকে দৈনিক হিসাব রিপোর্ট গ্রহণ করে
 * এবং Google Sheets-এ সংরক্ষণ করে।
 * 
 * সেটআপ:
 * 1. Google Sheets খুলুন → Extensions → Apps Script
 * 2. এই কোড পেস্ট করুন
 * 3. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. URL কপি করে Ledgero Settings-এ পেস্ট করুন
 */

// ── Config ──────────────────────────────────────────────────────────
const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const BN_DAYS = ['রবি','সোম','মঙ্গল','বুধ','বৃহস্পতি','শুক্র','শনি'];

// ── POST Handler ────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, dayData, bizInfo, lang, userId, secretKey } = payload;
    
    // Optional: Simple secret key check
    // if (secretKey !== 'YOUR_SECRET_KEY_HERE') {
    //   return jsonResponse({ success: false, error: 'Unauthorized' });
    // }
    
    if (action === 'export_day') {
      const result = exportDayData(dayData, bizInfo, lang || 'bn');
      return jsonResponse({ success: true, ...result });
    }
    
    return jsonResponse({ success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── GET Handler (for testing) ───────────────────────────────────────
function doGet(e) {
  return jsonResponse({ 
    status: 'ok', 
    message: 'Ledgero Sheets Export is active!',
    version: '2.0'
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Get or Create Monthly Spreadsheet ───────────────────────────────
function getOrCreateMonthlySpreadsheet(shopName, dateKey) {
  const [year, monthStr] = dateKey.split('-');
  const monthIndex = parseInt(monthStr, 10) - 1;
  const bnMonth = BN_MONTHS[monthIndex];
  const enMonth = EN_MONTHS[monthIndex];
  const title = `Ledgero_${shopName}_${bnMonth}_${year}`;
  
  // Search for existing spreadsheet by title
  const files = DriveApp.getFilesByName(title);
  if (files.hasNext()) {
    const file = files.next();
    return SpreadsheetApp.openById(file.getId());
  }
  
  // Create new spreadsheet
  const ss = SpreadsheetApp.create(title);
  
  // Rename default sheet to Index
  const indexSheet = ss.getSheets()[0];
  indexSheet.setName('সূচী (Index)');
  indexSheet.setTabColor('#1a80cc');
  
  // Write index header
  indexSheet.getRange('A1:D4').setValues([
    [`📊 ${shopName} — ${bnMonth} ${year} (${enMonth} ${year})`, '', '', ''],
    ['Ledgero দৈনিক হিসাব রিপোর্ট', '', '', ''],
    [`তৈরি: ${new Date().toLocaleDateString('bn-BD')}`, '', '', ''],
    ['দিন', 'তারিখ', 'নেট লাভ (৳)', 'মোট সম্পদ (৳)']
  ]);
  
  // Bold header
  indexSheet.getRange('A1:D1').setFontWeight('bold').setFontSize(14);
  indexSheet.getRange('A4:D4').setFontWeight('bold').setBackground('#e8f0fe');
  
  return ss;
}

// ── Export Day Data ─────────────────────────────────────────────────
function exportDayData(dayData, bizInfo, lang) {
  const { dateKey, wallets, inventory, transactions, loans, services, actualCash, cashMismatch } = dayData;
  
  const [year, monthStr, dayStr] = dateKey.split('-');
  const dayNum = parseInt(dayStr, 10);
  const dateObj = new Date(dateKey + 'T00:00:00');
  const dayOfWeek = dateObj.getDay();
  const dayName = BN_DAYS[dayOfWeek];
  const shopName = bizInfo?.name || 'Ledgero';
  
  const tabTitle = `Day-${String(dayNum).padStart(2, '0')} (${dayName})`;
  
  // 1. Get or create monthly spreadsheet
  const ss = getOrCreateMonthlySpreadsheet(shopName, dateKey);
  
  // 2. Create or clear the day sheet
  let daySheet = ss.getSheetByName(tabTitle);
  if (daySheet) {
    daySheet.clear();
  } else {
    daySheet = ss.insertSheet(tabTitle);
    daySheet.setTabColor('#26a64a');
  }
  
  // 3. Build rows
  const rows = [];
  const dateDisplay = new Date(dateKey + 'T00:00:00').toLocaleDateString(
    lang === 'bn' ? 'bn-BD' : 'en-US', 
    { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
  );
  
  // Header
  rows.push([`📊 ${shopName}`]);
  rows.push([`📅 ${dateDisplay}`]);
  rows.push([]); // spacer
  
  // ── Wallet Balances
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
  rows.push([]);
  
  // ── Inventory Summary
  rows.push(['📦 INVENTORY SUMMARY', '', '', '', '', '', '', '']);
  rows.push(['Product', 'Unit', 'Buy (৳)', 'Sell (৳)', 'Opening', 'Added', 'Closing', 'Sold', 'Revenue (৳)', 'COGS (৳)', 'Profit (৳)']);
  
  let totalRevenue = 0, totalCOGS = 0, totalProfit = 0;
  if (inventory && inventory.length) {
    inventory.forEach(item => {
      const sold = Math.max(0, (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0) - (Number(item.closingStock) || 0));
      const rev = sold * (Number(item.sellPrice) || 0);
      const cogs = sold * (Number(item.buyPrice) || 0);
      const profit = rev - cogs;
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
  rows.push([]);
  
  // ── Transactions
  rows.push(['📋 TRANSACTIONS', '', '', '', '', '']);
  rows.push(['Time', 'Type', 'Amount (৳)', 'Note', 'From', 'To', 'Customer']);
  
  let totalExpense = 0, totalDraw = 0, serviceIncome = 0;
  if (transactions && transactions.length) {
    transactions.forEach(tx => {
      const time = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString(
        'en-US', { hour: '2-digit', minute: '2-digit', hour12: true }
      ) : '';
      rows.push([
        time, tx.type, tx.amount || 0, tx.note || '',
        (tx.fromWallet || '').replace(/_/g, ' '),
        (tx.toWallet || '').replace(/_/g, ' '),
        tx.customerName || ''
      ]);
      if (tx.type === 'expense') totalExpense += (tx.amount || 0);
      if (tx.type === 'personal_draw' || tx.type === 'owner_took') totalDraw += (tx.amount || 0);
      if (tx.type === 'service_income') serviceIncome += (tx.amount || 0);
    });
  }
  rows.push([]);
  
  // ── Profit & Loss
  const rechargeProfit = (transactions || []).filter(tx => tx.type === 'recharge').reduce((sum, tx) => sum + (tx.profit || 0), 0);
  const svcPhotocopy = services?.photocopy || 0;
  const svcStudio = services?.studio || 0;
  const grossProfit = totalProfit + rechargeProfit + serviceIncome + svcPhotocopy + svcStudio;
  const netProfit = grossProfit - totalExpense - totalDraw;
  
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
  rows.push(['Personal Draw / Owner Took', -totalDraw]);
  rows.push(['═══════════════════════', '']);
  rows.push(['NET PROFIT', netProfit]);
  rows.push([]);
  
  // ── Cash Reconciliation
  const expectedCash = wallets?.hand_cash?.current || 0;
  rows.push(['🏦 CASH RECONCILIATION', '', '']);
  rows.push(['Item', 'Amount (৳)']);
  rows.push(['Expected Cash in Drawer', expectedCash]);
  rows.push(['Actual Cash Counted', actualCash != null ? actualCash : 'N/A']);
  rows.push(['Cash Mismatch', cashMismatch || 0]);
  rows.push([]);
  
  // ── Loans & Debts
  rows.push(['📊 LOANS & DEBTS (ধার-দেনা)', '', '', '']);
  rows.push(['Item', 'Opening (৳)', 'Closing (৳)']);
  rows.push(['Market Due (মহাজনকে দেবো)', loans?.openingTaken || 0, loans?.closingTaken || loans?.openingTaken || 0]);
  rows.push(['Customer Due (বাকি পাবো)', loans?.openingGiven || 0, loans?.closingGiven || loans?.openingGiven || 0]);
  
  // 4. Write all rows
  if (rows.length > 0) {
    // Normalize row lengths to 11 columns
    const maxCols = 11;
    const normalizedRows = rows.map(row => {
      const r = [...row];
      while (r.length < maxCols) r.push('');
      return r.slice(0, maxCols);
    });
    
    daySheet.getRange(1, 1, normalizedRows.length, maxCols).setValues(normalizedRows);
  }
  
  // 5. Format
  daySheet.getRange('A1:K2').setFontWeight('bold').setFontSize(13);
  daySheet.autoResizeColumns(1, 11);
  
  // 6. Update Index sheet
  const indexSheet = ss.getSheetByName('সূচী (Index)');
  if (indexSheet) {
    // Calculate total wealth
    let totalWealth = 0;
    if (wallets) {
      Object.entries(wallets).forEach(([key, w]) => {
        if (key !== '_order' && w) totalWealth += (w.closing || w.current || 0);
      });
    }
    
    const lastRow = Math.max(indexSheet.getLastRow() + 1, 5);
    indexSheet.getRange(lastRow, 1, 1, 4).setValues([
      [tabTitle, dateKey, netProfit, totalWealth]
    ]);
  }
  
  return {
    spreadsheetId: ss.getId(),
    tabTitle: tabTitle,
    url: ss.getUrl()
  };
}
