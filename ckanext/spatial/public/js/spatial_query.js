/* Module for handling the spatial querying
 */
this.ckan.module('spatial-query', function ($, _) {

    return {
        options: {
            i18n: {},
            style: {
                color: '#F06F64',
                weight: 2,
                opacity: 1,
                fillColor: '#F06F64',
                fillOpacity: 0.1,
                clickable: false
            },
            default_extent: [[90, 180], [-90, -180]]
        },
        template: {
            buttons: [
                '<div id="dataset-map-edit-buttons">',
                '<a href="javascript:;" class="btn cancel">Cancel</a> ',
                '<a href="javascript:;" class="btn apply disabled">Apply</a>',
                '</div>'
            ].join('')
        },

        initialize: function () {
            var module = this;
            $.proxyAll(this, /_on/);

            var user_default_extent = this.el.data('default_extent');
            if (user_default_extent) {
                if (user_default_extent instanceof Array) {
                    // Assume it's a pair of coords like [[90, 180], [-90, -180]]
                    this.options.default_extent = user_default_extent;
                } else if (user_default_extent instanceof Object) {
                    // Assume it's a GeoJSON bbox
                    this.options.default_extent = new L.GeoJSON(user_default_extent).getBounds();
                }
            }
            this.el.ready(this._onReady);
        },

        _getParameterByName: function (name) {
            var match = RegExp('[?&]' + name + '=([^&]*)')
                .exec(window.location.search);
            return match ?
                decodeURIComponent(match[1].replace(/\+/g, ' '))
                : null;
        },

        _drawExtentFromCoords: function (xmin, ymin, xmax, ymax) {
            if ($.isArray(xmin)) {
                var coords = xmin;
                xmin = coords[0];
                ymin = coords[1];
                xmax = coords[2];
                ymax = coords[3];
            }
            return new L.Rectangle([[ymin, xmin], [ymax, xmax]],
                this.options.style);
        },

        _drawExtentFromGeoJSON: function (geom) {
            return new L.GeoJSON(geom, {style: this.options.style});
        },

        _onReady: function () {

            var module = this;
            var map;
            var extentLayer;
            var previous_extent;
            var is_expanded = false;
            var form = $("#dataset-search");
            // CKAN 2.1
            if (!form.length) {
                form = $(".search-form");
            }

            var buttons;
            var rectangleDrawButtonFromLeafletDraw;
            var drawRectangleButton;
            var panDragButton;


            // Add necessary fields to the search form if not already created
            $(['ext_bbox', 'ext_prev_extent']).each(function (index, item) {
                if ($("#" + item).length === 0) {
                    $('<input type="hidden" />').attr({'id': item, 'name': item}).appendTo(form);
                }
            });

            // OK map time
            map = ckan.commonLeafletMap(
                'dataset-map-container',
                this.options.map_config,
                {
                    attributionControl: false,
                    drawControlTooltips: false,
                    maxBounds: [[90, 180], [-90, -180]],
                    maxBoundsViscosity: 1.0
                }
            );

            // This is required to control transition between Pan/Drag Map and Draw Rectangle mode.
            rectangleDrawButtonFromLeafletDraw = new L.Draw.Rectangle(map, {shapeOptions: module.options.style});

            // Button to draw rectangle bounding box on the map.
            drawRectangleButton = L.easyButton({
                id: 'draw-rectangle-button',  // an id for the generated button
                position: 'topright',      // inherited from L.Control -- the corner it goes in
                type: 'replace',          // set to animate when you're comfy with css
                leafletClasses: true,     // use leaflet classes to style the button?
                states: [
                    {
                        stateName: 'drawRectangleState',
                        onClick: function (button, map) {
                            expandMap();
                            rectangleDrawButtonFromLeafletDraw.enable();
                        },
                        title: 'Draw Rectangle',
                        icon: '&#11034;'
                    }
                ]
            });

            // Button to enable Pan/Drag Map mode.
            panDragButton = L.easyButton({
                id: 'pan-drag-button',  // an id for the generated button
                position: 'topright',      // inherited from L.Control -- the corner it goes in
                type: 'replace',          // set to animate when you're comfy with css
                leafletClasses: true,     // use leaflet classes to style the button?
                states: [
                    {
                        stateName: 'panDragMapState',
                        onClick: function (button, map) {
                            expandMap();
                            rectangleDrawButtonFromLeafletDraw.disable();
                        },
                        title: 'Pan/Drag Map',
                        icon: '&#9995;'
                    }
                ]
            });

            // Create a toolbar for Draw Rectangle and Pan/Drag Map buttons.
            L.easyBar([drawRectangleButton, panDragButton], {position: 'topright'})
                .addTo(map, module.options.style);

            // Setup the expanded buttons
            buttons = $(module.template.buttons).insertBefore('#dataset-map-attribution');

            // Handle the cancel expanded action
            $('.cancel', buttons).on('click', function () {
                $('body').removeClass('dataset-map-expanded');
                if (extentLayer) {
                    map.removeLayer(extentLayer);
                }
                setPreviousExtent();
                setPreviousBBBox();
                resetMap();
                is_expanded = false;
                if (previous_extent) {
                    coords = previous_extent.split(',');
                    map.fitBounds([[coords[1], coords[0]], [coords[3], coords[2]]]);
                }
                else {
                    map.fitBounds(module.options.default_extent);
                }
            });

            // Handle the apply expanded action
            $('.apply', buttons).on('click', function () {
                if (extentLayer) {
                    $('body').removeClass('dataset-map-expanded');
                    is_expanded = false;
                    resetMap();
                    // Eugh, hacky hack.
                    setTimeout(function () {
                        map.fitBounds(extentLayer.getBounds());
                        submitForm();
                    }, 200);
                }
            });

            // When user finishes drawing the box, record it and add it to the map
            map.on('draw:created', function (e) {
                if (extentLayer) {
                    map.removeLayer(extentLayer);
                }
                extentLayer = e.layer;
                $('#ext_bbox').val(extentLayer.getBounds().toBBoxString());
                map.addLayer(extentLayer);
                $('.apply', buttons).removeClass('disabled').addClass('btn-primary');
            });

            // Record the current map view so we can replicate it after submitting
            map.on('moveend', function (e) {
                $('#ext_prev_extent').val(map.getBounds().toBBoxString());
            });

            // Ok setup the default state for the map
            var previous_bbox;
            setPreviousBBBox();
            setPreviousExtent();

            // Is there an existing box from a previous search?
            function setPreviousBBBox() {
                previous_bbox = module._getParameterByName('ext_bbox');
                if (previous_bbox) {
                    $('#ext_bbox').val(previous_bbox);
                    extentLayer = module._drawExtentFromCoords(previous_bbox.split(','))
                    map.addLayer(extentLayer);
                    map.fitBounds(extentLayer.getBounds());
                }
            }

            // Is there an existing extent from a previous search?
            function setPreviousExtent() {
                previous_extent = module._getParameterByName('ext_prev_extent');
                if (previous_extent) {
                    coords = previous_extent.split(',');
                    map.fitBounds([[coords[1], coords[0]], [coords[3], coords[2]]]);
                } else {
                    if (!previous_bbox) {
                        map.fitBounds(module.options.default_extent);
                    }
                }
            }

            // Reset map view
            function resetMap() {
                L.Util.requestAnimFrame(map.invalidateSize, map, !1, map._container);
            }

            // Submit the form
            function submitForm() {
                setTimeout(function () {
                    form.submit();
                }, 800);
            }

            // Expands the map and performs one level of zoom-in.
            function expandMap() {
                // If not already expanded, expand the map
                if (!is_expanded) {
                    //Adding this class expands the map
                    $('body').addClass('dataset-map-expanded');
                    resetMap();
                    is_expanded = true;

                    // If no bounding box on map, zoom two steps to remove grey area
                    if (!previous_extent) {
                        map.zoomIn(2);
                    }
                    //else zoomIn once to maintain bounding box edges on expanded map
                    else {
                        map.zoomIn();
                    }
                }
            }

            // Expand the map when smaller map is clicked.
            $("#dataset-map-container").on('click', '*', function () {
                expandMap();
            });
        }
    }
});
