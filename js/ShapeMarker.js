// ShapeMarker.js — Custom Leaflet canvas markers (square, triangle, diamond)

export const ShapeMarker = L.CircleMarker.extend({
    options: {
        shape: 'circle' // 'circle', 'square', 'triangle', 'triangle-down', 'diamond', 'x'
    },

    _updatePath: function () {
        if (this.options.shape === 'circle') {
            this._renderer._updateCircle(this);
            return;
        }

        const p = this._point;
        const r = this._radius;
        const ctx = this._renderer._ctx;
        const shape = this.options.shape;

        ctx.beginPath();

        if (shape === 'square') {
            ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        }
        else if (shape === 'triangle') {

            const angle30 = 30 * (Math.PI / 180);
            const angle150 = 150 * (Math.PI / 180);


            ctx.moveTo(p.x, p.y - r);

            ctx.lineTo(p.x + r * Math.cos(angle30), p.y + r * Math.sin(angle30));

            ctx.lineTo(p.x + r * Math.cos(angle150), p.y + r * Math.sin(angle150));

            ctx.closePath();
        }
        else if (shape === 'triangle-down') {
            // Outfall marker
            const angle30 = 30 * (Math.PI / 180);
            const angle150 = 150 * (Math.PI / 180);

            // Vertices at 120° intervals, apex pointing down
            const a1 = Math.PI / 2;
            const a2 = a1 + (2 * Math.PI / 3);
            const a3 = a1 - (2 * Math.PI / 3);

            ctx.moveTo(p.x + r * Math.cos(a1), p.y + r * Math.sin(a1));
            ctx.lineTo(p.x + r * Math.cos(a2), p.y + r * Math.sin(a2));
            ctx.lineTo(p.x + r * Math.cos(a3), p.y + r * Math.sin(a3));
            ctx.closePath();
        }
        else if (shape === 'diamond') {
            // 1.2× radius to visually match circle bounding box
            ctx.moveTo(p.x, p.y - r * 1.2);
            ctx.lineTo(p.x + r * 1.2, p.y);
            ctx.lineTo(p.x, p.y + r * 1.2);
            ctx.lineTo(p.x - r * 1.2, p.y);
            ctx.closePath();
        }
        else if (shape === 'x') {
            const d = r * 0.7;
            ctx.moveTo(p.x - d, p.y - d);
            ctx.lineTo(p.x + d, p.y + d);
            ctx.moveTo(p.x + d, p.y - d);
            ctx.lineTo(p.x - d, p.y + d);
        }

        this._renderer._fillStroke(ctx, this);
    }
});
