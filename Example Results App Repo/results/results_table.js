// results/results_table.js

export function renderResultsTable(sectionData) {
    if (!sectionData) return '<div style="padding:20px;">No data for this section.</div>';

    const { id_col, out_columns, rows } = sectionData;

    let html = '<table class="results-table"><thead><tr>';
    out_columns.forEach(col => {
        html += `<th>${col}</th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach(row => {
        // Determine row class based on status
        let rowClass = '';
        if (row.Status === 'CHANGED') rowClass = 'changed';
        else if (row.Status === 'ONLY_IN_A') rowClass = 'only-in-a';
        else if (row.Status === 'ONLY_IN_B') rowClass = 'only-in-b';

        html += `<tr class="${rowClass}">`;

        out_columns.forEach(col => {
            const val = row[col] !== undefined ? row[col] : '';
            html += `<td>${val}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}
