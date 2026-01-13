const inputArea = document.getElementById('inputArea');
const processedList = document.getElementById('processedList');
const emptyState = document.getElementById('emptyState');
const totalCountEl = document.getElementById('totalCount');
const totalAmountEl = document.getElementById('totalAmount');
const clearBtn = document.getElementById('clearBtn');
const processBtn = document.getElementById('processBtn');

// Helper to format currency
// Requirement: No "Rp", use comma "," for thousands.
const formatCurrency = (num) => {
    // en-US uses comma for thousands, dot for decimals.
    // We want integer usually, but if decimal needed, it handles it.
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0 // Assuming integers for nominal usually
    }).format(num);
};

// Update Time
setInterval(() => {
    const now = new Date();
    document.getElementById('currentTime').innerText = now.toLocaleTimeString('id-ID');
}, 1000);

// Prefix mapping for E-Wallets
const PREFIXES = {
    'DANA': '3901',
    'OVO': '39358',
    'GOPAY': '70001',
    'LINKAJA': '09110',
    'SHOPEEPAY': '112'
};

// Main Parsing Logic
const processData = (rawData) => {
    const processedData = [];
    let totalAmount = 0;

    // 1. HTML PARSER (Priority 1)
    const isHtml = /<tr|<td|<div|data-changekey/i.test(rawData);
    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<table><tbody>${rawData}</tbody></table>`, 'text/html');
        const rows = doc.querySelectorAll('tr');
        rows.forEach(row => {
            const amountEl = row.querySelector('[data-changekey="amount"], [data-changekey="withdrawAmount"]');
            let nominalStr = amountEl ? (amountEl.innerText || amountEl.textContent) : '';

            let nominal = 0;
            if (nominalStr) {
                let clean = nominalStr.trim().replace(/[^\d\.,]/g, '');
                if (clean.includes('.') && clean.includes(',')) {
                    if (clean.lastIndexOf('.') > clean.lastIndexOf(',')) clean = clean.replace(/,/g, '');
                    else clean = clean.replace(/\./g, '').replace(/,/g, '.');
                } else if (clean.includes(',')) clean = clean.replace(/,/g, '');
                nominal = parseFloat(clean);
            }

            if (nominal > 0) {
                const cells = Array.from(row.querySelectorAll('td'));
                let bank = '';
                let noRek = '';
                let username = '';
                let namaRek = '';

                // Strict Bank Check for HTML as well
                const bankList = ['BCA', 'BRI', 'MANDIRI', 'BNI', 'DANA', 'GOPAY', 'OVO', 'LINKAJA', 'SEABANK', 'DANAMON', 'CIMB', 'MAYBANK', 'JAGO', 'USDT', 'BSI'];

                cells.forEach(cell => {
                    const txt = cell.innerText.trim();
                    if (!txt) return;

                    const upper = txt.toUpperCase();
                    // Check if strictly matches a bank or contains it clearly
                    const foundBank = bankList.find(b => upper === b || upper.startsWith(b + ' ') || upper.endsWith(' ' + b));

                    if (foundBank && !bank) bank = foundBank;
                    else if (/^\d{8,25}$/.test(txt.replace(/[-\s]/g, '')) && !noRek) noRek = txt;
                });

                if (bank) {
                    let finalNoRek = noRek;
                    const bankKey = Object.keys(PREFIXES).find(k => bank.includes(k));
                    if (bankKey && !finalNoRek.startsWith(PREFIXES[bankKey])) {
                        const rawNums = finalNoRek.replace(/[^\d]/g, '');
                        if (!rawNums.startsWith(PREFIXES[bankKey])) finalNoRek = PREFIXES[bankKey] + finalNoRek;
                    }
                    processedData.push({ bank, noRek: finalNoRek, username: username || '-', namaRek: namaRek || '-', nominal });
                    totalAmount += nominal;
                }
            }
        });
        if (processedData.length > 0) return { processedData, totalAmount };
    }

    // 2. TEXT PARSING
    const lines = rawData.split(/\r?\n/).filter(line => line.trim() !== '');
    // Updated Bank List including new requests
    const bankList = ['BCA', 'BRI', 'MANDIRI', 'BNI', 'DANA', 'GOPAY', 'OVO', 'LINKAJA', 'SEABANK', 'DANAMON', 'CIMB', 'MAYBANK', 'JAGO', 'USDT', 'BSI'];

    // CHECK FOR MULTI-LINE BLOCK FORMAT (Anchor: "Deposit")
    const hasDepositKeyword = lines.some(l => l.includes('Deposit'));

    if (hasDepositKeyword) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.includes('Deposit')) {
                // FOUND ANCHOR: "Deposit 2026-01-13 20:55:58 ... 20,000 ... "

                // 1. EXTRACT NOMINAL
                let nominal = 0;
                // Tokens: ["Deposit", "Date", "Time", "Amount", "Fee?"]
                // Example: Deposit	2026-01-13 21:02:02	200,000	115.65
                const parts = line.split(/[\t\s]+/);
                for (const p of parts) {
                    if (/[\d,]+\.?\d*/.test(p) && p.length > 3 && !p.includes(':') && !p.includes('-')) {
                        let clean = p.replace(/,/g, '');
                        const val = parseFloat(clean);
                        if (!isNaN(val) && val > 0 && val < 100000000000) {
                            nominal = val;
                            break;
                        }
                    }
                }

                // 2. EXTRACT USERNAME (Line before)
                let username = '-';
                if (i > 0) {
                    const prev = lines[i - 1].trim();
                    // "1	atirdian"
                    const prevParts = prev.split(/[\t\s]+/);
                    if (prevParts.length > 1 && /^\d+$/.test(prevParts[0])) {
                        username = prevParts[1];
                    } else {
                        username = prevParts[0];
                    }
                }

                // 3. EXTRACT BANK INFO (Line after)
                // "G3	BANK DANA, 0822..., NAME	From : ..."
                let bank = '';
                let noRek = '';
                let namaRek = '';

                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    // Regex: Match "BANK [NAME], [NUM], [NAME]" ignoring leading G-code
                    const match = nextLine.match(/(?:G\d+\s+)?BANK\s+([A-Z]+)[,\s]+(\d+)[,\s]+(.*?)(?:\s+From|\s+To|\t|$)/i);

                    if (match) {
                        bank = match[1].toUpperCase();
                        noRek = match[2];
                        namaRek = match[3].trim();

                        // Extra cleanup for NAME if it contains " - " or split chars
                        if (namaRek.includes(' - ')) namaRek = namaRek.split(' - ')[0];
                    }
                }

                if (nominal > 0 && bank) {
                    let finalNoRek = noRek;
                    const bankKey = Object.keys(PREFIXES).find(k => bank.includes(k));
                    if (bankKey && !finalNoRek.startsWith(PREFIXES[bankKey])) {
                        finalNoRek = PREFIXES[bankKey] + finalNoRek;
                    }

                    processedData.push({ bank, noRek: finalNoRek, username, namaRek, nominal });
                    totalAmount += nominal;
                }
            }
        }
    } else {
        // SINGLE LINE FALLBACK
        lines.forEach((line) => {
            let bank = '';
            let noRek = '';
            let username = '';
            let namaRek = '';
            let nominal = 0;
            let isValidRow = false;

            const tokens = line.split(/[\t]+| {2,}/).map(t => t.trim()).filter(t => t !== '');

            // STRICT BANK DETECTION
            const bankIndex = tokens.findIndex(t => {
                const clean = t.toUpperCase().replace(/[^A-Z]/g, '');
                return bankList.includes(clean);
            });

            if (bankIndex !== -1) {
                isValidRow = true;
                bank = tokens[bankIndex].toUpperCase().replace(/[^A-Z]/g, '');

                if (bankIndex >= 1) noRek = tokens[bankIndex - 1];
                if (bankIndex >= 2) namaRek = tokens[bankIndex - 2];
                if (bankIndex >= 3) username = tokens[bankIndex - 3];

                // Find Nominal after Bank
                for (let k = bankIndex + 1; k < tokens.length; k++) {
                    const token = tokens[k];
                    if (/[a-zA-Z]/.test(token)) continue;
                    if (token.includes('-') && token.length > 8) continue;

                    let clean = token.replace(/,/g, '');
                    // Handle decimals
                    if (clean.includes('.') && clean.split('.')[1].length === 2) {
                        // keep decimal
                    } else if (clean.includes('.')) {
                        // assume thousands separator
                    }

                    const val = parseFloat(clean);
                    if (!isNaN(val) && val > 0) {
                        if (val > 100000000000) continue;
                        nominal = val;
                        break;
                    }
                }

                if (nominal > 0) {
                    let finalNoRek = noRek;
                    const bankKey = Object.keys(PREFIXES).find(k => bank.includes(k));
                    if (bankKey && !finalNoRek.startsWith(PREFIXES[bankKey])) {
                        finalNoRek = PREFIXES[bankKey] + finalNoRek;
                    }
                    processedData.push({ bank, noRek: finalNoRek, username: username || '-', namaRek: namaRek || '-', nominal });
                    totalAmount += nominal;
                }
            }
        });
    }
    return { processedData, totalAmount };
};

// Optimization: Use Fragment for Performance
const renderData = (data) => {
    processedList.innerHTML = '';

    if (data.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    const fragment = document.createDocumentFragment();
    data.forEach(item => {
        const tr = document.createElement('tr');
        const bankClass = item.bank.toLowerCase().replace(/[^a-z0-9]/g, '-');

        tr.innerHTML = `
            <td class="bank-cell"><span class="badge bank bank-${bankClass}">${item.bank}</span></td>
            <td class="account-number" onclick="copyText('${item.noRek}')" title="Click to copy">${item.noRek}</td>
            <td>${item.username}</td>
            <td>${item.namaRek}</td>
            <td>${formatCurrency(item.nominal)}</td>
        `;
        fragment.appendChild(tr);
    });
    processedList.appendChild(fragment);
};

window.copyText = (text) => {
    navigator.clipboard.writeText(text);
};

const updateSummary = (count, amount, data) => {
    if (totalCountEl) totalCountEl.innerText = count;
    if (totalAmountEl) totalAmountEl.innerText = formatCurrency(amount);
};

// Sort & Render Column 3 (Optimized)
const renderSortedData = (data) => {
    const sortedContainer = document.getElementById('sortedList');

    if (data.length === 0) {
        sortedContainer.innerHTML = '<div class="empty-state">Menunggu Data...</div>';
        const summaryContainer = document.getElementById('filterSummary');
        if (summaryContainer) summaryContainer.innerHTML = '';
        return;
    }

    // Group by Bank
    const grouped = data.reduce((acc, item) => {
        const key = item.bank.toUpperCase();
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    // Sort Banks Alphabetically
    const sortedKeys = Object.keys(grouped).sort();

    // RENDER HEADER SUMMARY BADGES
    const summaryContainer = document.getElementById('filterSummary');
    if (summaryContainer) {
        summaryContainer.innerHTML = sortedKeys.map(bank => {
            const count = grouped[bank].length;
            const bankClass = bank.toLowerCase().replace(/[^a-z0-9]/g, '-');
            return `<span class="summary-badge bank-${bankClass}">${bank} ${count}</span>`;
        }).join('');
    }

    // Prepare Table HTML
    let tableHtml = `
        <div class="group-table-container">
            <table class="sorted-table">
                <thead>
                    <tr>
                        <th style="width: 5%">BANK</th>
                        <th style="width: 20%">NO. REK</th>
                        <th style="width: 15%">USER</th>
                        <th style="width: 40%">NAMA</th>
                        <th style="width: 20%">JML</th>
                    </tr>
                </thead>
                <tbody id="sortedTableBody">`;

    // Append rows (String concatenation is fast)
    sortedKeys.forEach(bank => {
        const groupItems = grouped[bank];
        const bankClass = bank.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const rowsHtml = groupItems.map(item => `
            <tr>
                <td class="s-cell-bank"><span class="badge bank bank-${bankClass}">${item.bank}</span></td>
                <td class="s-cell-norek account-number" onclick="copyText('${item.noRek}')">${item.noRek}</td>
                <td class="s-cell-user">${item.username}</td>
                <td class="s-cell-name">${item.namaRek}</td>
                <td class="s-cell-nominal">${formatCurrency(item.nominal)}</td>
            </tr>
        `).join('');

        tableHtml += rowsHtml;
    });

    tableHtml += `</tbody></table></div>`;
    sortedContainer.innerHTML = tableHtml;
};

// Utilities: Debounce
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

// Event Listener for Paste/Input (Debounced)
const handleInput = debounce((e) => {
    const text = e.target.value;
    if (!text.trim()) {
        renderData([]);
        renderSortedData([]);
        updateSummary(0, 0, []);
        return;
    }

    const { processedData, totalAmount } = processData(text);
    renderData(processedData);
    renderSortedData(processedData);
    updateSummary(processedData.length, totalAmount, processedData);
}, 200); // Optimized to 200ms for balance between snapiness and perf

if (inputArea) inputArea.addEventListener('input', handleInput);

if (processBtn) processBtn.addEventListener('click', () => {
    const text = inputArea ? inputArea.value : '';
    const { processedData, totalAmount } = processData(text);
    renderData(processedData);
    renderSortedData(processedData);
    updateSummary(processedData.length, totalAmount);
});

if (clearBtn) clearBtn.addEventListener('click', () => {
    if (inputArea) inputArea.value = '';
    renderData([]);
    renderSortedData([]);
    updateSummary(0, 0);
});
