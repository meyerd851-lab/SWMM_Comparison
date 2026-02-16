// ShapeMarker.js - Custom Leaflet marker with shapes (Square, Triangle, Diamond)
// Extends L.CircleMarker to use the Canvas renderer for high performance.

export const ShapeMarker = L.CircleMarker.extend({
    options: {
        shape: 'circle' // 'circle', 'square', 'triangle', 'triangle-down', 'diamond', 'x'
    },

    _updatePath: function () {
        // If it's a circle, use the default renderer method
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
            // Upward pointing triangle
            // Height of equilateral triangle = r * sqrt(3) is a bit tall, let's keep it simple
            // Centroid to top is r, centroid to base is r/2? 
            // Let's just draw loosely within the radius circle

            const angle30 = 30 * (Math.PI / 180);
            const angle150 = 150 * (Math.PI / 180);
            const angle270 = 270 * (Math.PI / 180); // Top

            // Leaflet canvas uses standard canvas coordinates
            // 3 points
            // We essentially want `r` to be the distance from center to vertex

            // Top vertex
            ctx.moveTo(p.x, p.y - r);
            // Bottom Right
            ctx.lineTo(p.x + r * Math.cos(angle30), p.y + r * Math.sin(angle30));
            // Bottom Left
            ctx.lineTo(p.x + r * Math.cos(angle150), p.y + r * Math.sin(angle150));

            ctx.closePath();
        }
        else if (shape === 'triangle-down') {
            // Inverted triangle (likely for Outfall)
            const angle30 = 30 * (Math.PI / 180);
            const angle150 = 150 * (Math.PI / 180);

            // Bottom vertex
            ctx.moveTo(p.x, p.y + r);
            // Top Right
            ctx.lineTo(p.x + r * Math.cos(angle30), p.y - r * Math.sin(angle30)); // Approximate check
            // Using simpler math:
            // Top Left: (-r, -r/2) is rough?
            // Let's use exact 120 degree separation

            // 90 degrees is down (Math.PI/2)
            // 90 + 120 = 210
            // 90 - 120 = -30 (330)

            const a1 = Math.PI / 2; // Down
            const a2 = a1 + (2 * Math.PI / 3);
            const a3 = a1 - (2 * Math.PI / 3);

            ctx.moveTo(p.x + r * Math.cos(a1), p.y + r * Math.sin(a1));
            ctx.lineTo(p.x + r * Math.cos(a2), p.y + r * Math.sin(a2));
            ctx.lineTo(p.x + r * Math.cos(a3), p.y + r * Math.sin(a3));
            ctx.closePath();
        }
        else if (shape === 'diamond') {
            ctx.moveTo(p.x, p.y - r * 1.2); // Top
            ctx.lineTo(p.x + r * 1.2, p.y); // Right
            ctx.lineTo(p.x, p.y + r * 1.2); // Bottom
            ctx.lineTo(p.x - r * 1.2, p.y); // Left
            ctx.closePath();
        }
        else if (shape === 'x') {
            // For excluded or special?
            const d = r * 0.7;
            ctx.moveTo(p.x - d, p.y - d);
            ctx.lineTo(p.x + d, p.y + d);
            ctx.moveTo(p.x + d, p.y - d);
            ctx.lineTo(p.x - d, p.y + d);
            // 'x' is usually a stroke, not fill. but fillStroke will handle it if we closePath or not.
            // If we want a filled X, it's a polygon. If just lines, we need to be careful with fill.
            // Let's avoid X for now or treat as lines.
        }

        this._renderer._fillStroke(ctx, this);
    }
});
