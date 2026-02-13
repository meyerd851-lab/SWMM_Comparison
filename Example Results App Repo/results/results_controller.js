// results/results_controller.js
import { renderResultsTable } from './results_table.js';
// We'll integrate the map logic once we wire up the events

export class ResultsController {
    constructor() {
        this.data = null;
        this.activeSection = null;
        this.activeMetric = null;
        this.thresholds = { low: 5, high: 10 };
    }

    init() {
        console.log("ResultsController initialized.");

        // Event Listeners for Tab Switching
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.dataset.target;
                this.switchTab(target);
            });
        });

        // Toggle results view logic?
        // Maybe handle section clicks within results view

        document.getElementById('res-update-map')?.addEventListener('click', () => {
            this.updateMapVisualization();
        });
    }

    handleData(jsonData) {
        console.log("Results Data Received:", jsonData);
        this.data = jsonData;

        // Populate Sections Sidebar (if we want to reuse sidebar or create new list?)
        // For now, let's just list sections in a simple way or reuse sidebar logic?
        // The existing app uses #sections in sidebar. 
        // We might need to swap sidebar content based on active tab.

        this.renderSidebar();
    }

    renderSidebar() {
        if (!this.data) return;
        const container = document.getElementById('results-sections-list');
        if (!container) return; // Need to add this to index.html

        container.innerHTML = '';
        this.data.sections.forEach(sec => {
            const div = document.createElement('div');
            div.className = 'sec-item';
            div.textContent = sec.section;
            div.onclick = () => this.loadSection(sec.section);
            container.appendChild(div);
        });
    }

    loadSection(sectionName) {
        this.activeSection = sectionName;
        const sectionData = this.data.sections.find(s => s.section === sectionName);

        // Render Table
        const tableContainer = document.getElementById('results-table-container');
        if (tableContainer) {
            tableContainer.innerHTML = renderResultsTable(sectionData);
        }

        // populate Metric dropdown?
        // Check core_results.py METRIC_CONFIG for this section?
        // or just guess numeric columns?

        // Auto-update map if possible
        this.updateMapVisualization();
    }

    updateMapVisualization() {
        if (!this.activeSection || !this.data) return;

        const sectionData = this.data.sections.find(s => s.section === this.activeSection);
        if (!sectionData) return;

        // Try to find a metric column (e.g., "Dif ...")
        // For simplicity, let's look for known metrics from core_results.py logic
        // The core logic puts result col at the end.

        const cols = sectionData.out_columns;
        const metricCol = cols[cols.length - 1]; // Assume last col is the metric

        if (metricCol === "Status") return; // No metric available

        const min = parseFloat(document.getElementById('res-min').value) || 5;
        const max = parseFloat(document.getElementById('res-max').value) || 10;

        import('./results_map.js').then(mod => {
            mod.updateResultsMap(this.data, this.activeSection, metricCol, { low: min, high: max });
        });
    }

    switchTab(tabName) {
        // Hide all views
        document.querySelectorAll('.view-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

        // Show target
        const targetView = document.getElementById(`${tabName}-view`);
        if (targetView) targetView.style.display = 'flex';

        const btn = document.querySelector(`.tab-btn[data-target="${tabName}"]`);
        if (btn) btn.classList.add('active');

        // Sidebar switching logic
        if (tabName === 'results') {
            document.getElementById('sections').style.display = 'none';
            document.getElementById('results-sections-list').style.display = 'block';
        } else {
            document.getElementById('sections').style.display = 'block';
            document.getElementById('results-sections-list').style.display = 'none';
        }
    }
}

export const resultsController = new ResultsController();
