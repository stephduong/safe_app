document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/stephanieduong/cma6mtyeb007l01spbgeudpe3', // Custom style
        center: [151.2093, -33.8688],  // Sydney, Australia
        zoom: 11
    });
    
    // Expose map to different window variables for cross-script access
    window.mapInstance = map;
    window.map = map;  // Also expose as map for safety.js

    // DOM elements
    const startAddressInput = document.getElementById('start-address');
    const endAddressInput = document.getElementById('end-address');
    const findRouteBtn = document.getElementById('find-route-btn');
    // Create dummy elements for removed buttons to prevent errors
    const adjustRouteBtn = document.createElement('button');
    const resetRouteBtn = document.createElement('button');
    const errorNotification = document.getElementById('error-notification');
    const loadingIndicator = document.getElementById('loading');
    // const drawPointsBtn = document.getElementById('draw-points-btn'); // Button removed from UI
    const clearPointsBtn = document.getElementById('clear-points-btn');
    const poiSearchInput = document.getElementById('poi-search');
    const poiSearchBtn = document.getElementById('poi-search-btn');

    // Get search icons
    const startSearchIcon = startAddressInput.parentElement.querySelector('.search-icon');
    const endSearchIcon = endAddressInput.parentElement.querySelector('.search-icon');

    // Create autocomplete dropdowns for address inputs
    const startAutocompleteDropdown = document.createElement('div');
    startAutocompleteDropdown.className = 'autocomplete-dropdown';
    startAddressInput.parentElement.appendChild(startAutocompleteDropdown);
    
    const endAutocompleteDropdown = document.createElement('div');
    endAutocompleteDropdown.className = 'autocomplete-dropdown';
    endAddressInput.parentElement.appendChild(endAutocompleteDropdown);
    
    // Application state
    const state = {
        startCoords: null,
        endCoords: null,
        currentRoute: null,
        originalRoute: null,
        customPoints: [],
        pois: [],
        selectedPois: [],
        waypoints: [],
        drawingMode: false,
        crimeData: null,
        streetLamps: [], // Add street lamps array to state
        hospitals: [], // Add hospitals array to state
        policeStations: [], // Add police stations array to state
        mapMode: 'normal',
        routeAlternatives: [], // Add array to store route alternatives
        safetyScoresCalculated: false, // Flag to track if safety scores have been calculated
        filteredSafetyData: null // New state for filtered safety data
    };
    
    window.state = state; // Expose state to window for chat.js access

    // State for marker placement mode
    let markerPlacementMode = null; // Can be 'start', 'end', or null

    // Map sources and layers
    map.on('load', function() {
        // Add source for route line
        map.addSource('route', {
            type: 'geojson',
            data: {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            }
        });
        
        // Add source for traffic signals
        map.addSource('traffic-signals', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        // Add layer for traffic signal halos
        map.addLayer({
            id: 'traffic-signal-halos',
            type: 'circle',
            source: 'traffic-signals',
            paint: {
                'circle-color': 'rgba(186, 104, 200, 0.3)', // Keep original light purple color with transparency
                'circle-radius': 10, // Match hospital halo size
                'circle-stroke-width': 1, // Match hospital halo stroke
                'circle-stroke-color': 'rgba(255, 255, 255, 0.5)' // Match hospital halo stroke color
            },
            layout: {
                'visibility': 'none'
            }
        });

        // Add layer for traffic signals
        map.addLayer({
            id: 'traffic-signals',
            type: 'circle',
            source: 'traffic-signals',
            paint: {
                'circle-color': '#BA68C8', // Keep original light purple color
                'circle-radius': 5, // Match hospital marker size
                'circle-stroke-width': 1, // Match hospital marker stroke
                'circle-stroke-color': 'rgba(255, 255, 255, 0.9)' // Match hospital marker stroke color
            },
            layout: {
                'visibility': 'none'
            }
        });

        // Add popup for traffic signals
        map.on('mouseenter', 'traffic-signals', function(e) {
            const coordinates = e.features[0].geometry.coordinates.slice();
            
            // Create popup
            new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 10
            })
            .setLngLat(coordinates)
            .setHTML('<strong>Traffic Signal</strong><br><small>Click to add to route</small>')
            .addTo(map);
        });

        map.on('mouseleave', 'traffic-signals', function() {
            // Remove popup
            const popups = document.getElementsByClassName('mapboxgl-popup');
            if (popups.length) {
                popups[0].remove();
            }
        });

        // Add layer for route line
        map.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#2196F3', // Change to a bright blue color
                'line-width': 8,
                'line-opacity': 1,
                'line-blur': 0.5, // Add slight blur for a glow effect
                'line-offset': 0
            }
        });

        // Add a second line layer for route outline
        map.addLayer({
            id: 'route-outline',
            type: 'line',
            source: 'route',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#FFFFFF',
                'line-width': 12,
                'line-opacity': 0.4,
                'line-blur': 1
            },
            filter: ['==', '$type', 'LineString']
        }, 'route'); // Place this layer below the actual route line

        // Add source for custom points
        map.addSource('custom-points', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        // Add layer for custom points
        map.addLayer({
            id: 'custom-points',
            type: 'circle',
            source: 'custom-points',
            paint: {
                'circle-radius': [
                    'case',
                    ['==', ['get', 'pointType'], 'start'], 8,
                    ['==', ['get', 'pointType'], 'end'], 8,
                    8
                ],
                'circle-color': [
                    'case',
                    ['==', ['get', 'pointType'], 'start'], '#4CAF50', // Green for start
                    ['==', ['get', 'pointType'], 'end'], '#FF7043',   // Orange for end
                    '#9C27B0' // Purple for other custom points
                ],
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'pointType'], 'start'], 0.8,
                    ['==', ['get', 'pointType'], 'end'], 0.8,
                    0.8
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF'
            }
        });

        // Add source for route markers (start, end)
        map.addSource('markers', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        // Add layer for marker halos
        map.addLayer({
            id: 'marker-halos',
            type: 'circle',
            source: 'markers',
            paint: {
                'circle-radius': 25, // Increased from 18 to make a larger hit area
                'circle-color': [
                    'match',
                    ['get', 'marker-type'],
                    'start', 'rgba(76, 175, 80, 0.25)', // Green for start point
                    'end', 'rgba(255, 112, 67, 0.25)',
                    'rgba(0, 0, 0, 0.2)'  // default color
                ],
                'circle-opacity': 1,
                'circle-stroke-width': 2,
                'circle-stroke-color': [
                    'match',
                    ['get', 'marker-type'],
                    'start', '#4CAF50', // Green for start point
                    'end', '#FF7043',
                    '#000000'  // default color
                ]
            },
            interactive: true
        });

        // Add layer for route markers
        map.addLayer({
            id: 'markers',
            type: 'circle',
            source: 'markers',
            paint: {
                'circle-radius': 12,
                'circle-color': [
                    'match',
                    ['get', 'marker-type'],
                    'start', '#4CAF50',  // Green for start point
                    'end', '#FF7043',    // Accent orange color
                    '#000000'            // default color
                ],
                'circle-opacity': 1,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF'
            },
            interactive: true
        });

        // Add labels for markers
        map.addLayer({
            id: 'marker-labels',
            type: 'symbol',
            source: 'markers',
            layout: {
                'text-field': [
                    'match',
                    ['get', 'marker-type'],
                    'start', 'A',
                    'end', 'B',
                    ''
                ],
                'text-size': 13,
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-offset': [0, 0]
            },
            paint: {
                'text-color': '#FFFFFF',
                'text-halo-width': 1,
                'text-halo-color': 'rgba(0, 0, 0, 0.2)'
            }
        });

        // Add click listener for map to add custom points in drawing mode
        map.on('click', function(e) {
            if (state.isDrawingMode) {
                addCustomPoint(e.lngLat);
            }
        });

        // Add source for POIs
        map.addSource('pois', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        // Add layer for POI halos
        map.addLayer({
            id: 'poi-halos',
            type: 'circle',
            source: 'pois',
            paint: {
                'circle-radius': 12,
                'circle-color': '#FFFFFF',
                'circle-opacity': 0.9,
                'circle-stroke-width': 1,
                'circle-stroke-color': [
                    'case',
                    ['boolean', ['get', 'selected'], false],
                    '#FF9800',  // Selected color
                    ['match',
                    ['get', 'type'],
                    'restaurant', '#FF7043',
                    'park', '#4CAF50',
                    'cafe', '#795548',
                    '#9C27B0'  // default color
                    ]
                ]
            }
        });

        // Add layer for POIs
        map.addLayer({
            id: 'pois',
            type: 'circle',
            source: 'pois',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['boolean', ['get', 'selected'], false],
                    '#FF9800',  // Selected color
                    ['match',
                    ['get', 'type'],
                    'restaurant', '#FF7043',
                    'park', '#4CAF50',
                    'cafe', '#795548',
                    '#9C27B0'  // default color
                    ]
                ],
                'circle-opacity': 0.9,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF'
            }
        });

        // Add popup for POIs
        map.on('mouseenter', 'pois', function(e) {
            const coordinates = e.features[0].geometry.coordinates.slice();
            const name = e.features[0].properties.name;
            const description = e.features[0].properties.description || '';
            
            // Create popup
            new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 10
            })
            .setLngLat(coordinates)
            .setHTML(`<strong>${name}</strong>${description ? '<br>' + description : ''}`)
            .addTo(map);
        });

        map.on('mouseleave', 'pois', function() {
            // Remove popup
            const popups = document.getElementsByClassName('mapboxgl-popup');
            if (popups.length) {
                popups[0].remove();
            }
        });

        // Add click handler for POIs
        map.on('click', 'pois', function(e) {
            const poiId = e.features[0].properties.id;
            if (poiId) {
                window.togglePoiSelection(poiId);
            }
        });

        // Change cursor on POI hover
        map.on('mouseenter', 'pois', function() {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'pois', function() {
            map.getCanvas().style.cursor = '';
        });

        // Add street lamp layers
        addStreetLampLayers();
        
        // Add hospital layers
        addHospitalLayers();
    });
    
    // Add click listener for custom points
    map.on('click', 'custom-points', function(e) {
        // Don't select points in drawing mode
        if (!state.isDrawingMode) {
            const pointId = e.features[0].properties.id;
            const pointIndex = state.customPoints.findIndex(p => p.id === pointId);
            
            if (pointIndex !== -1) {
                // Remove the point
                state.customPoints.splice(pointIndex, 1);
                updateCustomPointsOnMap();
                updateMarkers();
            }
        }
        
        // Stop propagation to prevent adding a new point at the same location
        e.originalEvent.stopPropagation();
    });

    // Change cursor on custom point hover
    map.on('mouseenter', 'custom-points', function() {
        if (!state.isDrawingMode) {
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('mouseleave', 'custom-points', function() {
        if (!state.isDrawingMode) {
            map.getCanvas().style.cursor = '';
        }
    });

    // Add popup for custom points
    map.on('mouseenter', 'custom-points', function(e) {
        if (state.isDrawingMode) return;
        
        const coordinates = e.features[0].geometry.coordinates.slice();
        const name = e.features[0].properties.name || 'Custom Point';
        
        // Create popup
        new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 10
        })
        .setLngLat(coordinates)
        .setHTML(`<strong>${name}</strong>`)
        .addTo(map);
    });
    
    map.on('mouseleave', 'custom-points', function() {
        // Remove popup
        const popups = document.getElementsByClassName('mapboxgl-popup');
        if (popups.length) {
            popups[0].remove();
        }
    });

    // Event listeners
    findRouteBtn.addEventListener('click', findRoute);
    adjustRouteBtn.addEventListener('click', adjustRoute);
    resetRouteBtn.addEventListener('click', resetRoute);
    // drawPointsBtn.addEventListener('click', toggleDrawingMode); // Button removed
    clearPointsBtn.addEventListener('click', clearCustomPoints);
    
    // Traffic signals toggle
    const toggleTrafficSignalsBtn = document.getElementById('toggle-traffic-signals');
    if (toggleTrafficSignalsBtn) {
        toggleTrafficSignalsBtn.addEventListener('click', toggleTrafficSignals);
    }
    
    // Traffic signals state
    let trafficSignalsVisible = false;
    let trafficSignalsLoaded = false;
    let allTrafficSignals = []; // Store all traffic signals
    let filteredTrafficSignals = []; // Store filtered traffic signals
    
    // Initial values for safety controls
    let safetyFilterActive = false;
    let safetyRadius = 0; // Default radius in meters
    
    // Get the safety radius slider and value display
    const safetyRadiusSlider = document.getElementById('safety-radius');
    const radiusValueDisplay = document.getElementById('radius-value');
    const resetSafetyFilterBtn = document.getElementById('reset-safety-filter');
    
    // Add debounce function to improve slider performance
    let safetySliderTimeout = null;
    function debounce(callback, wait) {
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(safetySliderTimeout);
            safetySliderTimeout = setTimeout(() => callback.apply(context, args), wait);
        };
    }
    
    // Update radius value and apply filter when slider changes
    if (safetyRadiusSlider) {
        // Combined listener for both updating display and applying filter
        safetyRadiusSlider.addEventListener('input', function() {
            // Update the radius value display immediately
            safetyRadius = parseInt(this.value);
            radiusValueDisplay.textContent = safetyRadius;
            
            // Apply the filter immediately if data is loaded
            if (crimeMarkersLoaded && trafficSignalsLoaded) {
                // Use requestAnimationFrame to optimize performance during dragging
                if (this._animationFrame) {
                    cancelAnimationFrame(this._animationFrame);
                }
                
                this._animationFrame = requestAnimationFrame(function() {
                    applyTrafficSignalFilter();
                });
            }
        });
    }
    
    // Crime markers toggle
    const toggleCrimeBtn = document.getElementById('toggle-crime');
    if (toggleCrimeBtn) {
        toggleCrimeBtn.addEventListener('click', toggleCrimeMarkers);
    }
    
    // Crime markers state
    let crimeMarkersVisible = false;
    let crimeMarkersLoaded = false;
    let crimeMarkersLayer = null;
    let crimeData = null;
    
    // Make crime markers state globally accessible
    window.crimeMarkersVisible = false;
    window.crimeMarkersLoaded = false;
    
    // Street lamps toggle
    const toggleStreetLampsBtn = document.getElementById('toggle-street-lamps');
    if (toggleStreetLampsBtn) {
        toggleStreetLampsBtn.addEventListener('click', toggleStreetLamps);
    }
    
    // Hospital toggle
    const toggleHospitalsBtn = document.getElementById('toggle-hospitals');
    if (toggleHospitalsBtn) {
        toggleHospitalsBtn.addEventListener('click', toggleHospitals);
    }
    
    // Police station toggle
    const togglePoliceStationsBtn = document.getElementById('toggle-police-stations');
    if (togglePoliceStationsBtn) {
        togglePoliceStationsBtn.addEventListener('click', togglePoliceStations);
    }
    
    // Add event listeners for marker drag events
    map.on('mouseenter', 'markers', function() {
        map.getCanvas().style.cursor = 'move';
    });
    
    map.on('mouseleave', 'markers', function() {
        map.getCanvas().style.cursor = '';
    });
    
    // Variables to track dragging state
    let isDragging = false;
    let draggedMarkerType = null;
    let originalCoords = null;
    
    // Start drag when mousedown on marker
    map.on('mousedown', 'markers', function(e) {
        console.log('Marker mousedown detected', e.features[0].properties['marker-type']);
        
        // Prevent the event from bubbling up to the map
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault(); // Prevent any default behaviors
        
        // Explicitly disable map dragging
        map.dragPan.disable();
        
        // Get the marker type (start or end)
        draggedMarkerType = e.features[0].properties['marker-type'];
        
        // Store original coordinates in case we need to cancel the drag
        originalCoords = e.features[0].geometry.coordinates.slice();
        
        // Start dragging
        isDragging = true;
        
        // Change cursor
        map.getCanvas().style.cursor = 'grabbing';
        document.body.classList.add('dragging-marker');
        
        // Add a class to the canvas container
        const canvasContainer = map.getCanvasContainer();
        canvasContainer.classList.add('markers-point', 'dragging');
    });
    
    // Track mouse move during drag
    map.on('mousemove', function(e) {
        if (!isDragging) return;
        
        console.log('Dragging in progress', draggedMarkerType);
        
        // Update coordinates based on mouse position
        if (draggedMarkerType === 'start') {
            state.startCoords = [e.lngLat.lng, e.lngLat.lat];
            console.log('Updated start coords', state.startCoords);
        } else if (draggedMarkerType === 'end') {
            state.endCoords = [e.lngLat.lng, e.lngLat.lat];
            console.log('Updated end coords', state.endCoords);
        }
        
        // Update marker on map immediately
        updateMarkers();
        
        // Don't update custom points during drag - this creates the purple circle
        // We'll update them only on mouseup
    });
    
    // End drag on mouseup
    map.on('mouseup', function() {
        if (!isDragging) return;
        
        console.log('Drag ended', draggedMarkerType);
        
        // Reset dragging state
        isDragging = false;
        
        // Re-enable map dragging
        map.dragPan.enable();
        
        // Update custom points for consistency now that drag is complete
        if (draggedMarkerType === 'start') {
            state.customPoints = state.customPoints.filter(p => p.pointType !== 'start');
            const newPoint = {
                id: 'custom-' + Date.now(),
                name: 'Start Point',
                lng: state.startCoords[0],
                lat: state.startCoords[1],
                type: 'custom',
                pointType: 'start'
            };
            state.customPoints.push(newPoint);
        } else if (draggedMarkerType === 'end') {
            state.customPoints = state.customPoints.filter(p => p.pointType !== 'end');
            const newPoint = {
                id: 'custom-' + Date.now(),
                name: 'End Point',
                lng: state.endCoords[0],
                lat: state.endCoords[1],
                type: 'custom',
                pointType: 'end'
            };
            state.customPoints.push(newPoint);
        }
        
        // Now update custom points on map
        updateCustomPointsOnMap();
        
        // Update address fields with new coordinates
        if (draggedMarkerType === 'start') {
            startAddressInput.value = `${state.startCoords[1].toFixed(6)}, ${state.startCoords[0].toFixed(6)}`;
        } else if (draggedMarkerType === 'end') {
            endAddressInput.value = `${state.endCoords[1].toFixed(6)}, ${state.endCoords[0].toFixed(6)}`;
        }
        
        // Reset cursor
        map.getCanvas().style.cursor = '';
        document.body.classList.remove('dragging-marker');
        
        // Remove the dragging class from the canvas container
        const canvasContainer = map.getCanvasContainer();
        canvasContainer.classList.remove('markers-point', 'dragging');
        
        // Update route if we have both start and end coordinates
        if (state.startCoords && state.endCoords) {
            getRoute(); // Recalculate route with new marker positions
        }
        
        // Reset marker tracking variables
        draggedMarkerType = null;
        originalCoords = null;
    });
    
    // Cancel drag if mouse leaves the map
    map.getCanvas().addEventListener('mouseleave', function() {
        if (!isDragging) return;
        
        // Reset to original position
        if (draggedMarkerType === 'start' && originalCoords) {
            state.startCoords = originalCoords;
        } else if (draggedMarkerType === 'end' && originalCoords) {
            state.endCoords = originalCoords;
        }
        
        // Reset dragging state
        isDragging = false;
        draggedMarkerType = null;
        originalCoords = null;
        
        // Update markers
        updateMarkers();
        updateCustomPointsOnMap();
        
        // Reset cursor
        map.getCanvas().style.cursor = '';
        document.body.classList.remove('dragging-marker');
        
        // Re-enable map dragging
        map.dragPan.enable();
    });
    
    // Address input handlers for search icon clicks
    startSearchIcon.addEventListener('click', () => {
        activateMarkerPlacementMode('start');
    });
    
    if (endSearchIcon) {
        endSearchIcon.addEventListener('click', async function() {
            const address = endAddressInput.value.trim();
            if (address) {
                const location = await geocodeAddress(address);
                if (location) {
                    state.endCoords = [location.lng, location.lat];
                    endAddressInput.value = location.address || `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
                    
                    // Add custom point for the end address
                    state.customPoints = state.customPoints.filter(p => p.pointType !== 'end');
                    const id = 'custom-' + Date.now();
                    const newPoint = {
                        id: id,
                        name: 'End Point',
                        lng: location.lng,
                        lat: location.lat,
                        type: 'custom',
                        pointType: 'end'
                    };
                    state.customPoints.push(newPoint);
                    
                    updateCustomPointsOnMap();
                    updateMarkers();
                    
                    // Zoom map to the marker location
                    map.flyTo({
                        center: [location.lng, location.lat],
                        zoom: 15,
                        speed: 1.2
                    });
                    
                    // Enable route finding if both points are set
                    if (state.startCoords && state.endCoords) {
                        findRouteBtn.disabled = false;
                    }
                    
                    // Hide dropdown
                    endAutocompleteDropdown.classList.remove('show');
                    
                    // Show confirmation
                    showNotification('Destination point set', 'success');
                }
            }
        });
    }
    
    // Add input event listeners for autocomplete
    startAddressInput.addEventListener('input', function() {
        // Only fetch suggestions if at least 3 characters are entered
        if (this.value.trim().length >= 3) {
            fetchAddressSuggestions(this.value.trim(), 'start');
        } else {
            startAutocompleteDropdown.innerHTML = '';
            startAutocompleteDropdown.classList.remove('show');
        }
    });
    
    endAddressInput.addEventListener('input', function() {
        // Only fetch suggestions if at least 3 characters are entered
        if (this.value.trim().length >= 3) {
            fetchAddressSuggestions(this.value.trim(), 'end');
        } else {
            endAutocompleteDropdown.innerHTML = '';
            endAutocompleteDropdown.classList.remove('show');
        }
    });

    // Enable enter key for address inputs
    startAddressInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter' && !startAutocompleteDropdown.classList.contains('show')) {
            if (endAddressInput.value.trim()) {
                findRoute();
            } else {
                endAddressInput.focus();
            }
        }
    });
    
    // Event listeners for inputs to activate marker placement mode
    startAddressInput.addEventListener('click', function() {
        // Don't activate if already in drawing mode
        if (state.isDrawingMode) return;
        
        // Activate marker placement mode for start location
        markerPlacementMode = 'start';
        
        // Clear the input field
        startAddressInput.value = '';
        
        // Highlight the active input
        startAddressInput.classList.add('active-input');
        endAddressInput.classList.remove('active-input');
        
        // Set the cursor more explicitly
        map.getCanvas().style.cursor = 'crosshair';
        document.body.classList.add('marker-placement-active');
        
        // Show instruction notification
        showNotification('Click on the map to place your start point', 'info');
    });
    
    endAddressInput.addEventListener('click', function() {
        // Don't activate if already in drawing mode
        if (state.isDrawingMode) return;
        
        // Activate marker placement mode for end location
        markerPlacementMode = 'end';
        
        // Clear the input field
        endAddressInput.value = '';
        
        // Highlight the active input
        endAddressInput.classList.add('active-input');
        startAddressInput.classList.remove('active-input');
        
        // Set the cursor more explicitly
        map.getCanvas().style.cursor = 'crosshair';
        document.body.classList.add('marker-placement-active');
        
        // Show instruction notification
        showNotification('Click on the map to place your destination point', 'info');
    });
    
    // Add map click handler for marker placement
    map.on('click', function(e) {
        // Only handle clicks if we're in marker placement mode and not in drawing mode
        if (markerPlacementMode && !state.isDrawingMode) {
            const lngLat = e.lngLat;
            
            // Create point based on current mode
            if (markerPlacementMode === 'start') {
                // Remove any existing start point
                state.customPoints = state.customPoints.filter(p => p.pointType !== 'start');
                
                // Add new start point
                const id = 'custom-' + Date.now();
                const newPoint = {
                    id: id,
                    name: 'Start Point',
                    lng: lngLat.lng,
                    lat: lngLat.lat,
                    type: 'custom',
                    pointType: 'start'
                };
                
                state.customPoints.push(newPoint);
                state.startCoords = [lngLat.lng, lngLat.lat];
                startAddressInput.value = `${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`;
                
                // Properly reset cursor and remove active class
                startAddressInput.classList.remove('active-input');
                map.getCanvas().style.cursor = '';
                document.body.classList.remove('marker-placement-active');
                
                // Zoom map to the marker location
                map.flyTo({
                    center: [lngLat.lng, lngLat.lat],
                    zoom: 15,
                    speed: 1.2
                });
                
                // Show confirmation
                showNotification('Start point set', 'success');
                
            } else if (markerPlacementMode === 'end') {
                // Remove any existing end point
                state.customPoints = state.customPoints.filter(p => p.pointType !== 'end');
                
                // Add new end point
                const id = 'custom-' + Date.now();
                const newPoint = {
                    id: id,
                    name: 'End Point',
                    lng: lngLat.lng,
                    lat: lngLat.lat,
                    type: 'custom',
                    pointType: 'end'
                };
                
                state.customPoints.push(newPoint);
                state.endCoords = [lngLat.lng, lngLat.lat];
                endAddressInput.value = `${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`;
                
                // Properly reset cursor and remove active class
                endAddressInput.classList.remove('active-input');
                map.getCanvas().style.cursor = '';
                document.body.classList.remove('marker-placement-active');
                
                // Zoom map to the marker location
                map.flyTo({
                    center: [lngLat.lng, lngLat.lat],
                    zoom: 15,
                    speed: 1.2
                });
                
                // Show confirmation
                showNotification('Destination point set', 'success');
            }
            
            // Update markers on map
            updateCustomPointsOnMap();
            updateMarkers();
            
            // Reset marker placement mode
            markerPlacementMode = null;
            
            // Enable route finding if both points are set
            if (state.startCoords && state.endCoords) {
                findRouteBtn.disabled = false;
            }
            
            // Prevent the map click from triggering other handlers
            e.originalEvent.stopPropagation();
        }
    });
    
    endAddressInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter' && !endAutocompleteDropdown.classList.contains('show')) {
            if (startAddressInput.value.trim()) {
                findRoute();
            } else {
                startAddressInput.focus();
            }
        }
    });

    // Functions
    function toggleDrawingMode() {
        state.isDrawingMode = !state.isDrawingMode;
        
        if (state.isDrawingMode) {
            drawPointsBtn.textContent = 'Cancel Drawing';
            drawPointsBtn.style.backgroundColor = '#F44336';
            showNotification('Click on the map to place markers. Press ESC to cancel.', 'info');
            
            // Set cursor for drawing more explicitly
            map.getCanvas().style.cursor = 'crosshair';
            document.body.classList.add('drawing-mode-active');
            
            // Clear any active marker placement modes
            if (markerPlacementMode) {
                markerPlacementMode = null;
                startAddressInput.classList.remove('active-input');
                endAddressInput.classList.remove('active-input');
                document.body.classList.remove('marker-placement-active');
            }
        } else {
            drawPointsBtn.textContent = 'Draw Points on Map';
            drawPointsBtn.style.backgroundColor = '';
            map.getCanvas().style.cursor = '';
            document.body.classList.remove('drawing-mode-active');
            clearError();
        }
    }

    function addCustomPoint(lngLat) {
        // Limit to 2 points (start and end)
        if (state.customPoints.length >= 2) {
            showNotification('You can only add 2 points: start and end', 'error');
            return;
        }
        
        const id = 'custom-' + Date.now();
        const pointType = state.customPoints.length === 0 ? 'start' : 'end';
        const newPoint = {
            id: id,
            name: pointType === 'start' ? 'Start Point' : 'End Point',
            lng: lngLat.lng,
            lat: lngLat.lat,
            type: 'custom',
            pointType: pointType
        };
        
        state.customPoints.push(newPoint);
        updateCustomPointsOnMap();
        
        // Set the coordinates based on point type
        if (pointType === 'start') {
            state.startCoords = [lngLat.lng, lngLat.lat];
            startAddressInput.value = `${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`;
        } else {
            state.endCoords = [lngLat.lng, lngLat.lat];
            endAddressInput.value = `${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`;
        }
        
        updateMarkers();
        
        // If both points are added, exit drawing mode
        if (state.customPoints.length === 2) {
            state.isDrawingMode = false;
            map.getCanvas().style.cursor = '';
            drawPointsBtn.textContent = 'Draw Points on Map';
            showNotification('Both points added. You can now find a route.', 'success');
            findRouteBtn.disabled = false;
        }
    }

    function updateCustomPointsOnMap() {
        const features = state.customPoints.map(point => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [point.lng, point.lat]
            },
            properties: {
                id: point.id,
                name: point.name,
                type: 'custom',
                pointType: point.pointType // <-- Fix: use pointType, not 'marker-type'
            }
        }));
        
        const customPointsSource = map.getSource('custom-points');
        if (customPointsSource) {
            customPointsSource.setData({
                type: 'FeatureCollection',
                features: features
            });
        }
    }

    function clearCustomPoints() {
        // Clear point data
        state.customPoints = [];
        state.startCoords = null;
        state.endCoords = null;
        startAddressInput.value = '';
        endAddressInput.value = '';
        updateCustomPointsOnMap();
        updateMarkers();
        
        // Clear route data
        state.currentRoute = null;
        state.originalRoute = null;
        state.waypoints = [];
        
        // Clear route from map
        const routeSource = map.getSource('route');
        if (routeSource) {
            routeSource.setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            });
        }
        
        // Remove route info display if it exists
        const routeInfoEl = document.getElementById('route-info');
        if (routeInfoEl) {
            routeInfoEl.innerHTML = '';
            routeInfoEl.style.display = 'none';
        }
        
        // Update global state
        if (window.mapState) {
            window.mapState.hasRoute = false;
            window.mapState.routeLoaded = false;
            window.mapState.currentRouteLength = 0;
            window.mapState.currentRouteDistance = 0;
        }
        
        // --- Reset all filtered marker data and sources ---
        // Crime
        if (window._filteredCrimeData) {
            window._filteredCrimeData = null;
            // Call the proper reset function if available
        if (window.resetCrimeMarkersFilter && typeof window.resetCrimeMarkersFilter === 'function') {
                window.resetCrimeMarkersFilter(false); // Pass false to hide markers
            } else if (window._rawCrimeFeatures && map.getSource('crime-data')) {
                // Fallback to direct reset if function not available
                map.getSource('crime-data').setData({
                    type: 'FeatureCollection',
                    features: window._rawCrimeFeatures
                });
            }
        }
        // Street Lamps
        if (window._filteredStreetLamps) {
            window._filteredStreetLamps = null;
            if (window.state && window.state.streetLamps && map.getSource('street-lamps')) {
                map.getSource('street-lamps').setData({
                    type: 'FeatureCollection',
                    features: window.state.streetLamps
                });
            }
        }
        // Hospitals
        if (window._filteredHospitals) {
            window._filteredHospitals = null;
            if (window.state && window.state.hospitals && map.getSource('hospitals')) {
                map.getSource('hospitals').setData({
                    type: 'FeatureCollection',
                    features: window.state.hospitals
                });
            }
        }
        // Police Stations
        if (window._filteredPoliceStations) {
            window._filteredPoliceStations = null;
            if (window.state && window.state.policeStations && map.getSource('police-stations')) {
                map.getSource('police-stations').setData({
                    type: 'FeatureCollection',
                    features: window.state.policeStations
                });
            }
        }
        // --- End reset filtered marker data ---
        
        // Hide all marker layers after clearing points
        const layersToHide = [
            'crime-markers', 'crime-clusters', 'crime-cluster-count',
            'street-lamps', 'street-lamps-halo',
            'hospitals', 'hospitals-halo',
            'police-stations', 'police-stations-halo',
            'traffic-signals', 'traffic-signal-halos'
        ];
        layersToHide.forEach(layerId => {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', 'none');
            }
        });
        // Explicitly remove active class from crime toggle button
            const crimeBtn = document.getElementById('toggle-crime');
            if (crimeBtn) {
                crimeBtn.classList.remove('active');
            }
        // Also reset global state for crimeMarkersVisible
        window.crimeMarkersVisible = false;
        
        // Reset and hide hospital markers
        if (window.resetHospitalFilter && typeof window.resetHospitalFilter === 'function') {
            window.resetHospitalFilter(false);  // Pass false to ensure they're hidden
            
            // Update button appearance
            const hospitalBtn = document.getElementById('toggle-hospitals');
            if (hospitalBtn) {
                hospitalBtn.classList.remove('active');
            }
        }
        
        // Reset and hide police station markers
        if (window.resetPoliceStationFilter && typeof window.resetPoliceStationFilter === 'function') {
            window.resetPoliceStationFilter(false);  // Pass false to ensure they're hidden
            
            // Update button appearance
            const policeBtn = document.getElementById('toggle-police-stations');
            if (policeBtn) {
                policeBtn.classList.remove('active');
            }
        }
        
        // Reset and hide traffic signal markers
        if (window.resetTrafficSignalFilter && typeof window.resetTrafficSignalFilter === 'function') {
            window.resetTrafficSignalFilter();
            
            // Explicitly hide traffic signal layers
            map.setLayoutProperty('traffic-signals', 'visibility', 'none');
            map.setLayoutProperty('traffic-signal-halos', 'visibility', 'none');
            
            // Update button appearance
            const trafficBtn = document.getElementById('toggle-traffic-signals');
            if (trafficBtn) {
                trafficBtn.classList.remove('active');
            }
            
            // Hide the clustering slider
            const trafficClusterContainer = document.querySelector('.traffic-cluster-slider-container');
            if (trafficClusterContainer) {
                trafficClusterContainer.style.display = 'none';
            }
        }
        
        // Reset and hide street lamp markers
        if (window.resetStreetLampFilter && typeof window.resetStreetLampFilter === 'function') {
            window.resetStreetLampFilter();
            
            // Explicitly hide street lamp layer
            map.setLayoutProperty('street-lamps', 'visibility', 'none');
            
            // Update button appearance
            const streetLampBtn = document.getElementById('toggle-street-lamps');
            if (streetLampBtn) {
                streetLampBtn.classList.remove('active');
            }
        }
        
        // Show notification
        showNotification('Route and points have been cleared', 'info');
        
        // Disable route-related buttons
        findRouteBtn.disabled = true;
    }

    async function geocodeAddress(address) {
        showLoading(true);
        try {
            const response = await fetch('/geocode', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ address })
            });
            
            const data = await response.json();
            
            if (data.success) {
                return {
                    lat: data.lat,
                    lng: data.lng,
                    address: data.address
                };
            } else {
                showError(`Geocoding error: ${data.error}`);
                return null;
            }
        } catch (error) {
            showError(`Network error: ${error.message}`);
            return null;
        } finally {
            showLoading(false);
        }
    }

    async function findRoute() {
        clearError();
        
        if (!state.startCoords || !state.endCoords) {
            showError('Please set both start and end locations');
            return;
        }
        
        showLoading(true);
        
        try {
        // Get route
        await getRoute();
            
            // After the route is found and displayed, update the crime time panel
            const route = state.currentRoute;
            if (route) {
                // Always show and update the crime time panel
                updateCrimeTimePanel(route);
                const crimeTimePanel = document.getElementById('crime-time-panel');
                if (crimeTimePanel) {
                    crimeTimePanel.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error finding route:', error);
            showError('Failed to find route');
        } finally {
            showLoading(false);
        }
    }

    async function getRoute() {
        if (!state.startCoords || !state.endCoords) return Promise.resolve();
        
        showLoading(true);
        
        try {
            // Always use walking mode
            const travelMode = 'walking';
            
            // Prepare waypoints if any
            const waypoints = state.waypoints.map(wp => wp.coordinates);
            
            // Build request body once
            const requestBody = {
                start: state.startCoords,
                end: state.endCoords,
                mode: travelMode,
                waypoints: waypoints,
                alternatives: true // Request alternative routes
            };
            
            // Set a reasonable timeout to prevent hanging requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
            
            try {
                const response = await fetch('/route', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });
                
                // Clear the timeout since the request completed
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`Server responded with status: ${response.status}`);
                }
            
                const data = await response.json();
                
                if (data.success) {
                    // Store the main and alternative routes
                    const mainRoute = data.path;
                    state.currentRoute = mainRoute;
                    
                    if (!state.originalRoute) {
                        state.originalRoute = [...mainRoute];
                    }
                    
                    // Save any alternative routes provided
                    state.routeAlternatives = [];
                    
                    // Get the routing source (mapbox or osrm)
                    const routeSource = data.source || 'unknown';
                    console.log(`Using ${routeSource} routing engine for route calculation`);
                    
                    // Get alternatives from API response if available
                    const distance = data.distance;
                    const duration = data.duration;
                    
                    // Start with primary route
                    const routes = [{
                        path: mainRoute,
                        distance: distance,
                        duration: duration,
                        name: "Primary Route", // Will be renamed after safety calculation
                        isReal: true,
                        source: routeSource
                    }];
                    
                    // Add server-provided alternatives if available
                    if (data.alternatives && data.alternatives.length > 0) {
                        console.log(`Got ${data.alternatives.length} real alternative routes from API`);
                        // Add API provided alternatives
                        data.alternatives.forEach((alt, index) => {
                            // Check if this is a meaningful alternative by calculating how different it is from the main route
                            const isDifferentRoute = isSignificantlyDifferentRoute(mainRoute, alt.path);
                            
                            if (isDifferentRoute) {
                                routes.push({
                                    path: alt.path,
                                    distance: alt.distance,
                                    duration: alt.duration,
                                    name: `Route Option ${index + 2}`,
                                    isReal: true,
                                    source: alt.source || routeSource
                                });
                            } else {
                                console.log(`Alternative route ${index + 1} rejected - too similar to main route`);
                            }
                        });
                    }
                    
                    // Helper function to determine if a route is significantly different
                    function isSignificantlyDifferentRoute(route1, route2) {
                        // If lengths are very different, it's a different route
                        if (Math.abs(route1.length - route2.length) > route1.length * 0.2) {
                            return true;
                        }
                        
                        // Sample a few points along both routes and check how different they are
                        const numSamples = Math.min(5, Math.floor(route1.length / 2));
                        let differentPoints = 0;
                        
                        for (let i = 0; i < numSamples; i++) {
                            // Get sample point index (evenly distributed)
                            const index = Math.floor((i + 1) * (route1.length / (numSamples + 1)));
                            
                            if (index < route1.length && index < route2.length) {
                                const point1 = route1[index];
                                const point2 = route2[index];
                                
                                // Calculate distance between points
                                const distance = Math.sqrt(
                                    Math.pow(point1[0] - point2[0], 2) + 
                                    Math.pow(point1[1] - point2[1], 2)
                                );
                                
                                // If points are more than 0.001 degrees apart, consider them different
                                // (roughly 100 meters depending on latitude)
                                if (distance > 0.001) {
                                    differentPoints++;
                                }
                            }
                        }
                        
                        // If more than half the sampled points are different, it's a different route
                        return differentPoints > numSamples / 2;
                    }
                    
                    // Save route alternatives
                    state.routeAlternatives = routes;
                    
                    // Update route on map
                    updateRouteOnMap(mainRoute);
                    
                    // Calculate and save map bounds
                    calculateMapBounds(mainRoute);
                    
                    // Display route information
                    displayRouteInfo(distance, duration);
                    
                    // Calculate safety scores for all routes
                    await calculateSafetyScoresForRoutes();
                    
                    // Update the route options panel with alternatives
                    updateRouteOptionsPanel(state.routeAlternatives);
                    
                    // Enable reset button if we're not showing the original route
                    resetRouteBtn.disabled = JSON.stringify(state.currentRoute) === JSON.stringify(state.originalRoute);
                    
                    // Preload street lamp data for the route (running in background)
                    setTimeout(() => {
                        preloadStreetLampData(mainRoute).catch(error => {
                            console.warn('Non-critical error preloading lamp data:', error);
                        });
                    }, 500);
                    
                    // Update crime markers if they're visible (delayed to improve performance)
                    if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function') {
                        setTimeout(() => {
                            window.updateCrimeMarkersForRoute(mainRoute).catch(error => {
                                console.warn('Non-critical error updating crime markers:', error);
                            });
                        }, 1000);
                    }
                    
                    // Add a timeout to update the safety score after data is loaded
                    setTimeout(() => {
                        // Try to update safety score after both crime and street lamp data are loaded
                        if (window.updateSafetyScoreFromFiltered) {
                            console.log("Initializing safety score based on route data");
                            window.updateSafetyScoreFromFiltered();
                        }
                    }, 2000); // Run after 2 seconds to make sure other data is loaded
                    
                    return Promise.resolve(mainRoute);
                } else {
                    showError('Failed to calculate route');
                    return Promise.reject(new Error('Failed to calculate route'));
                }
            } catch (error) {
                // Check if this was a timeout
                if (error.name === 'AbortError') {
                    showError('Route calculation timed out - please try again');
                } else {
                    showError(`Error: ${error.message}`);
                }
                return Promise.reject(error);
            }
        } catch (error) {
            showError(`Network error: ${error.message}`);
            return Promise.reject(error);
        } finally {
            showLoading(false);
        }
    }
    
    // Add a new function to preload street lamp data
    async function preloadStreetLampData(route) {
        if (!route || route.length === 0) {
            console.error("Invalid route for street lamp preloading");
            return Promise.resolve(null);
        }
        
        try {
            console.log("Preloading street lamp data for route with", route.length, "points");
            
            // Calculate bbox that encompasses the route with some padding
            const bounds = new mapboxgl.LngLatBounds();
            
            // Handle different route coordinate formats
            for (let i = 0; i < route.length; i++) {
                try {
                    if (Array.isArray(route[i])) {
                        // Format [lng, lat] from route data
                        bounds.extend([route[i][0], route[i][1]]);
                    } else if (route[i].lat !== undefined && route[i].lng !== undefined) {
                        // Format {lat, lng} from safety.js
                        bounds.extend([route[i].lng, route[i].lat]);
                    } else {
                        console.warn("Unrecognized route coordinate at index", i, route[i]);
                    }
                } catch (e) {
                    console.error("Error extending bounds with point", route[i], e);
                }
            }
            
            // Add padding to the bounds (approximately 500m)
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const padding = 0.005; // about 500m
            
            const bbox = `${sw.lat - padding},${sw.lng - padding},${ne.lat + padding},${ne.lng + padding}`;
            console.log("Fetching street lamps in bbox:", bbox);
            
            // Fetch street lamps in this area
            const lamps = await fetchStreetLamps(bbox);
            
            // Make sure we have street lamps data
            if (!window.state.streetLamps || window.state.streetLamps.length === 0) {
                console.warn("Street lamp data not loaded correctly in preloadStreetLampData");
                window.state.streetLamps = lamps;
            }
            
            console.log(`Preloaded ${lamps.length} street lamps for the route`);
            
            // Force reload the data for safety score calculation
            if (lamps.length > 0) {
                // Make a direct analysis call to ensure data is ready
                const lightingData = await analyzeRouteLighting(route);
                console.log("Direct lighting analysis:", lightingData);
            }
            
            return lamps;
        } catch (error) {
            console.error('Error preloading street lamp data:', error);
            return Promise.resolve([]);
        }
    }

    async function adjustRoute() {
        // Check if we have custom points first
        let waypoints = [];
        
        // Add selected POIs
        if (state.selectedPois.length > 0) {
            waypoints = state.selectedPois.map(poiId => {
                const poi = state.pois.find(p => p.id === poiId);
                return [poi.lng, poi.lat];
            });
        }
        
        if (waypoints.length === 0) {
            showError('Please search and select at least one point of interest');
            return Promise.reject(new Error('No waypoints selected'));
        }
        
        showLoading(true);
        
        try {
            // Always use walking mode
            const travelMode = 'walking';
            
            const response = await fetch('/adjust_route', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    start: state.startCoords,
                    end: state.endCoords,
                    waypoints: waypoints,
                    mode: travelMode
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Save adjusted route
                state.currentRoute = data.path;
                
                // Update route on map
                updateRouteOnMap(data.path);
                
                // Update crime markers if they're visible
                if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function') {
                    console.log("Updating crime markers for adjusted route");
                    await window.updateCrimeMarkersForRoute(data.path);
                }
                
                // Display route information
                displayRouteInfo(data.distance, data.duration);
                
                // Enable reset button
                resetRouteBtn.disabled = false;
                
                // Preload street lamp data for the route
                preloadStreetLampData(data.path);
                
                return Promise.resolve(data.path);
            } else {
                showError('Failed to adjust route');
                return Promise.reject(new Error('Failed to adjust route'));
            }
        } catch (error) {
            showError(`Network error: ${error.message}`);
            return Promise.reject(error);
        } finally {
            showLoading(false);
        }
    }

    function resetRoute() {
        if (!state.originalRoute) return Promise.resolve();
        
        // Reset to original route
        state.currentRoute = [...state.originalRoute];
        
        // Update route on map
        updateRouteOnMap(state.currentRoute);
        
        // Update crime markers if they're visible
        if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function') {
            console.log("Updating crime markers for reset route");
            window.updateCrimeMarkersForRoute(state.currentRoute);
        }
        
        // Clear selected POIs
        state.selectedPois = [];
        
        // Disable reset button
        resetRouteBtn.disabled = true;
        
        return Promise.resolve(state.currentRoute);
    }

    function updateRouteOnMap(path) {
        if (!path || path.length < 2) {
            console.warn("Cannot update route on map: Invalid path data");
            return;
        }
        
        console.log(`Updating route on map with ${path.length} points`);
        
        // Set data for the route layer
        map.getSource('route').setData({
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': path
            }
        });
        
        // Ensure markers are updated
        updateMarkers();
        
        // Update crime markers if they're visible and we're not already handling it in getRoute
        // This prevents duplicate updates during drag operations
        if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function') {
            // Only proceed if we're not already updating from a drag operation
            if (!window._dragRouteUpdateInProgress) {
                console.log("Updating crime markers from updateRouteOnMap");
                
                // First update the crime markers
                window.updateCrimeMarkersForRoute(path).then(() => {
                    // After crime markers are updated, update the crime time panel
                    if (typeof window.updateCrimeTimePanel === 'function') {
                        console.log("Automatically updating crime time panel after route change");
                        window.updateCrimeTimePanel(path);
                    }
                }).catch(error => {
                    console.error("Error updating crime markers:", error);
                });
            } else {
                console.log("Skipping crime marker update in updateRouteOnMap (handled by drag operation)");
            }
        } else {
            // Always update the crime time panel even if markers aren't visible
            if (typeof window.updateCrimeTimePanel === 'function') {
                console.log("Updating crime time panel without crime markers");
                setTimeout(() => window.updateCrimeTimePanel(path), 500);
            }
        }
        
        // Fit the map to the route bounds
        const bounds = new mapboxgl.LngLatBounds();
        path.forEach(coord => bounds.extend(coord));
            
            map.fitBounds(bounds, {
                padding: 50
            });
    }

    function updateMarkers() {
        // Create markers for start and end
        const features = [];
        
        console.log('Updating markers with:', {
            start: state.startCoords, 
            end: state.endCoords
        });
        
        if (state.startCoords) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: state.startCoords
                },
                properties: {
                    'marker-type': 'start',
                    'draggable': true
                }
            });
        }
        
        if (state.endCoords) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: state.endCoords
                },
                properties: {
                    'marker-type': 'end',
                    'draggable': true
                }
            });
        }
        
        // Update markers layer data
        const markersSource = map.getSource('markers');
        if (markersSource) {
            markersSource.setData({
                type: 'FeatureCollection',
                features: features
            });
            console.log('Markers source updated with features:', features);
        } else {
            console.error('Markers source not found!');
        }
    }

    function calculateMapBounds(path) {
        if (path.length < 2) return;
        
        // Calculate bounding box
        let minLng = Infinity;
        let maxLng = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        
        path.forEach(point => {
            minLng = Math.min(minLng, point[0]);
            maxLng = Math.max(maxLng, point[0]);
            minLat = Math.min(minLat, point[1]);
            maxLat = Math.max(maxLat, point[1]);
        });
        
        // Add padding
        const padding = 0.05;
        minLng -= padding;
        maxLng += padding;
        minLat -= padding;
        maxLat += padding;
        
        // Save bounds
        state.mapBounds = [[minLng, minLat], [maxLng, maxLat]];
    }

    function showError(message) {
        showNotification(message, 'error');
    }

    function showNotification(message, type = 'error') {
        errorNotification.textContent = message;
        errorNotification.style.display = 'block';
        
        // Set notification color based on type
        if (type === 'error') {
            errorNotification.className = 'notification error';
        } else if (type === 'info') {
            errorNotification.className = 'notification info';
        } else if (type === 'success') {
            errorNotification.className = 'notification success';
        }
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (errorNotification.textContent === message) {
                clearError();
            }
        }, 5000);
    }

    function clearError() {
        errorNotification.textContent = '';
        errorNotification.style.display = 'none';
        errorNotification.className = 'notification';
    }

    function showLoading(show) {
        loadingIndicator.style.display = show ? 'block' : 'none';
    }

    // Add function to display route information
    function displayRouteInfo(distance, duration) {
        // Store route information in state for other functions to use
        state.currentRouteDistance = distance;
        state.currentRouteDuration = duration;
        
        // Format distance and duration for future use
        const distanceKm = (distance / 1000).toFixed(1);
        const totalMinutes = Math.ceil(duration / 60);
        
        let durationText;
        if (totalMinutes >= 60) {
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            durationText = `${hours} hr ${mins} min`;
        } else {
            durationText = `${totalMinutes} min`;
        }
        
        // Store formatted values
        state.formattedDistance = distanceKm;
        state.formattedDuration = durationText;
        
        // Update global state for other components
        window.mapState.currentRouteDistance = distance;
        window.mapState.currentRouteDuration = duration;
        window.mapState.routeLoaded = true;
        
        // Log route information for debugging
        console.log(`Route info: ${distanceKm} km, ${durationText}`);
        
        // Remove existing route-info element if it exists
        const existingRouteInfoEl = document.getElementById('route-info');
        if (existingRouteInfoEl) {
            existingRouteInfoEl.remove();
        }
        
        // Create a hidden safety score container for other functions to access
        if (!document.getElementById('safety-score-container')) {
            const hiddenContainer = document.createElement('div');
            hiddenContainer.id = 'safety-score-container';
            hiddenContainer.style.display = 'none';
            document.body.appendChild(hiddenContainer);
        }
    }
    
    // Calculate safety scores for all route alternatives and sort by safety
    async function calculateSafetyScoresForRoutes() {
        try {
            if (!state.routeAlternatives || state.routeAlternatives.length === 0) {
                console.log("No route alternatives to calculate safety scores for");
                return;
            }

            console.log("Calculating safety scores for", state.routeAlternatives.length, "routes");
            
            // Ensure we have crime data loaded
            if (!window.crimeMarkersVisible) {
                // Toggle crime markers on to ensure data is loaded
                await toggleCrimeMarkers();
                console.log("Crime markers toggled on for safety analysis");
            }
            
            // Force preload streetlight data with extended area to cover all routes
            // Create a combined bounding box for all routes
            const combinedBounds = new mapboxgl.LngLatBounds();
            
            // Add all route points to the bounds
            state.routeAlternatives.forEach(route => {
                if (route.path && route.path.length) {
                    route.path.forEach(point => {
                        if (Array.isArray(point)) {
                            combinedBounds.extend([point[0], point[1]]);
                        } else if (point.lat !== undefined && point.lng !== undefined) {
                            combinedBounds.extend([point.lng, point.lat]);
                        }
                    });
                }
            });
            
            // Add padding to the bounds and create bbox string
            const sw = combinedBounds.getSouthWest();
            const ne = combinedBounds.getNorthEast();
            const padding = 0.005; // about 500m
            const bbox = `${sw.lat - padding},${sw.lng - padding},${ne.lat + padding},${ne.lng + padding}`;
            
            // Prefetch all street lamp data for the area containing all routes
            console.log("Prefetching street lamp data for all routes");
            await fetchStreetLamps(bbox);
            console.log(`Loaded ${window.state.streetLamps?.length || 0} street lamps for safety analysis`);

            // Calculate safety scores for each route alternative
            console.log("Calculating individual route safety scores");
            const routesWithScores = await Promise.all(
                state.routeAlternatives.map(async (route, index) => {
                    try {
                        console.log(`Calculating safety score for route ${index + 1}`);
                        // Analyze this specific route using the preloaded lamp data
                        const lightingAnalysis = await analyzeRouteLighting(route.path);
                        console.log(`Route ${index + 1} lighting analysis:`, lightingAnalysis);
                        
                        const safetyScore = await calculateSafetyScore(route.path);
                        console.log(`Route ${index + 1} final safety score:`, safetyScore.score);
                        
                        // Verify we're getting different scores for different routes
                        return {
                            ...route,
                            safetyScore: safetyScore,
                            lightingData: lightingAnalysis
                        };
                    } catch (error) {
                        console.error("Error calculating safety score for route:", error);
                        return {
                            ...route,
                            safetyScore: {
                                score: 0,
                                rating: 'Unknown',
                                details: {}
                            }
                        };
                    }
                })
            );
            
            // Log all calculated safety scores for debugging
            console.log("All route safety scores:", routesWithScores.map((r, i) => 
                `Route ${i + 1}: score=${r.safetyScore?.score}, lighting=${r.lightingData?.count || 0} lamps`
            ));
            
            // Sort routes by safety score (highest/safest first)
            const sortedRoutes = [...routesWithScores].sort((a, b) => {
                const scoreA = a.safetyScore && a.safetyScore.score ? a.safetyScore.score : 0;
                const scoreB = b.safetyScore && b.safetyScore.score ? b.safetyScore.score : 0;
                return scoreB - scoreA; // Descending order (highest score first)
            });
            
            // Rename routes based on safety ranking
            sortedRoutes.forEach((route, index) => {
                if (index === 0) {
                    route.name = "Safest Route";
                } else if (index === 1) {
                    route.name = "Alternative Route 1";
                } else if (index === 2) {
                    route.name = "Alternative Route 2";
                } else {
                    route.name = `Route Option ${index + 1}`;
                }
            });

            // Update the state with the sorted routes
            state.routeAlternatives = sortedRoutes;
            
            // Set the safest route as the current route if it's the first load
            const isFirstLoad = !state.safetyScoresCalculated;
            if (isFirstLoad && sortedRoutes.length > 0) {
                state.currentRoute = sortedRoutes[0].path;
                updateRouteOnMap(sortedRoutes[0].path);
                displayRouteInfo(sortedRoutes[0].distance, sortedRoutes[0].duration);
            }
            
            // Mark that we've calculated safety scores
            state.safetyScoresCalculated = true;

            // Update the currently displayed safety score
            const currentRoute = sortedRoutes.find(
                route => JSON.stringify(route.path) === JSON.stringify(state.currentRoute)
            );
            
            if (currentRoute && currentRoute.safetyScore) {
                updateRouteSafetyScore(currentRoute.safetyScore);
            }
            
            // Update route options panel with new safety scores
            updateRouteOptionsPanel(sortedRoutes);

            return sortedRoutes;
        } catch (error) {
            console.error("Error calculating safety scores for routes:", error);
            return state.routeAlternatives;
        }
    }

    async function calculateSafetyScore(route) {
        if (!route || !route.length) {
            return {
                score: 0,
                rating: 'Unknown',
                details: {
                    lighting: 0,
                    crimeRisk: 0
                }
            };
        }
        
        try {
            console.log("Starting safety score calculation for route with", route.length, "points");
            
            // Get lighting analysis
            const lightingData = await analyzeRouteLighting(route);
            console.log("Lighting analysis:", lightingData);
            
            // Get crime incident data (use 100m buffer to catch nearby crime incidents)
            const crimeData = countCrimeIncidentsAlongRoute(route, 100);
            console.log("Crime data analysis:", crimeData);
            
            // Calculate lighting score (0-100)
            // Higher density of lamps = higher score
            let lightingScore;
            if (lightingData && typeof lightingData.density === 'number') {
                // Convert density to score: 0 lamps = 0, SAFE_LAMP_DENSITY (1.5) or more = 100
                const safetyRatio = Math.min(1, parseFloat(lightingData.density) / window.SAFE_LAMP_DENSITY);
                lightingScore = Math.round(safetyRatio * 100);
            } else {
                // Fallback if we couldn't get density
                lightingScore = lightingData && lightingData.coveragePercentage ? 
                    Math.round(parseFloat(lightingData.coveragePercentage)) : 50;
            }
            
            console.log("Calculated lighting score:", lightingScore);
            
            // Calculate crime risk score (0-100)
            // Higher count of incidents = lower score (higher risk)
            const routeLength = lightingData && lightingData.routeLength ? 
                parseFloat(lightingData.routeLength) / 1000 : 1; // Convert to km
                
            const crimeIncidentsPerKm = crimeData && crimeData.count ? crimeData.count / routeLength : 0;
            
            // Calculate weighted crime risk
            let crimeRiskScore;
            if (crimeIncidentsPerKm === 0) {
                // No crime incidents = perfect score
                crimeRiskScore = 100;
            } else if (crimeIncidentsPerKm <= 0.5) {
                // Very few incidents (0-0.5 per km) = good score (80-100)
                crimeRiskScore = 100 - (crimeIncidentsPerKm * 40);
            } else if (crimeIncidentsPerKm <= 2) {
                // Moderate incidents (0.5-2 per km) = medium score (50-80)
                crimeRiskScore = 80 - ((crimeIncidentsPerKm - 0.5) * 20);
            } else if (crimeIncidentsPerKm <= 5) {
                // Many incidents (2-5 per km) = poor score (20-50)
                crimeRiskScore = 50 - ((crimeIncidentsPerKm - 2) * 10);
            } else {
                // Extremely high crime (>5 per km) = very poor score (0-20)
                crimeRiskScore = Math.max(0, 20 - ((crimeIncidentsPerKm - 5) * 2));
            }
            
            // Round the score to nearest integer
            crimeRiskScore = Math.round(crimeRiskScore);
            console.log("Calculated crime risk score:", crimeRiskScore);
            
            // Added: Consider proximity to police stations (if available)
            let policeProximityBonus = 0;
            if (state.policeStations && state.policeStations.length > 0) {
                // Calculate average distance to nearest police station
                const policeStationDistances = [];
                const samplePoints = [];
                
                // Sample points along route (at most 5 points)
                const sampleInterval = Math.max(1, Math.floor(route.length / 5));
                for (let i = 0; i < route.length; i += sampleInterval) {
                    if (samplePoints.length >= 5) break;
                    samplePoints.push(route[i]);
                }
                
                // For each sampled point, find nearest police station
                for (const routePoint of samplePoints) {
                    let minDistance = Infinity;
                    for (const station of state.policeStations) {
                        const stationCoords = [station.lng, station.lat];
                        const distance = haversineDistance(
                            routePoint[1], routePoint[0], 
                            station.lat, station.lng
                        );
                        minDistance = Math.min(minDistance, distance);
                    }
                    
                    if (minDistance < Infinity) {
                        policeStationDistances.push(minDistance);
                    }
                }
                
                // Convert to bonus points (0-10)
                if (policeStationDistances.length > 0) {
                    const avgDistance = policeStationDistances.reduce((a, b) => a + b, 0) / policeStationDistances.length;
                    // Distance in kilometers
                    const avgDistanceKm = avgDistance / 1000;
                    
                    // Closer stations give higher bonus (max 10 points)
                    // 0-1km = 10 points, 1-3km = 7 points, 3-5km = 4 points, 5km+ = 0-2 points
                    if (avgDistanceKm < 1) {
                        policeProximityBonus = 10;
                    } else if (avgDistanceKm < 3) {
                        policeProximityBonus = 7;
                    } else if (avgDistanceKm < 5) {
                        policeProximityBonus = 4;
                    } else {
                        policeProximityBonus = Math.max(0, Math.min(2, 10 - avgDistanceKm));
                    }
                }
            }
            console.log("Police proximity bonus:", policeProximityBonus);
            
            // Calculate overall safety score (weighted average with new factors)
            // Weigh lighting 35%, crime risk 55%, and police proximity 10%
            const lightingWeight = 0.35;
            const crimeRiskWeight = 0.55;
            const policeProximityWeight = 0.10;
            
            const overallScore = (lightingScore * lightingWeight) + 
                               (crimeRiskScore * crimeRiskWeight) + 
                               (policeProximityBonus * 10 * policeProximityWeight); // Convert 0-10 to 0-100 scale
                               
            const normalizedScore = Math.round(Math.max(0, Math.min(100, overallScore)));
            console.log("Final safety score:", normalizedScore);
            
            // Determine rating text
            let rating = 'Unknown';
            if (normalizedScore >= 80) {
                rating = 'Excellent';
            } else if (normalizedScore >= 60) {
                rating = 'Good';
            } else if (normalizedScore >= 40) {
                rating = 'Moderate';
            } else if (normalizedScore >= 20) {
                rating = 'Poor';
            } else {
                rating = 'Very Poor';
            }
            
            return {
                score: normalizedScore,
                rating: rating,
                details: {
                    lighting: Math.round(lightingScore),
                    crimeRisk: Math.round(crimeRiskScore),
                    policeProximity: Math.round(policeProximityBonus),
                    lampsCount: lightingData.count || 0,
                    lampsPerKm: Math.round((lightingData.count || 0) / routeLength),
                    crimeIncidents: crimeData.count || 0,
                    crimeIncidentsPerKm: crimeIncidentsPerKm.toFixed(1)
                }
            };
        } catch (error) {
            console.error('Error calculating safety score:', error);
            return {
                score: 0,
                rating: 'Error',
                details: {
                    lighting: 0,
                    crimeRisk: 0,
                    error: error.message
                }
            };
        }
    }

    // Helper function: Haversine distance between two points
    function haversineDistance(lat1, lon1, lat2, lon2) {
        // Convert degrees to radians
        const toRad = value => value * Math.PI / 180;
        
        const R = 6371000; // Earth radius in meters
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        
        return R * c; // Distance in meters
    }

    // Update the route options panel with alternatives
    function updateRouteOptionsPanel(routeOptions) {
        try {
            const container = document.getElementById('route-options-container');
            if (!container) return;
            
            // Clear existing content
            container.innerHTML = '';
            
            if (!routeOptions || routeOptions.length === 0) {
                container.innerHTML = '<p class="route-options-hint">Find a route to see available options</p>';
                return;
            }
            
            // Create an element for each route option
            routeOptions.forEach((route, index) => {
                const isSelected = JSON.stringify(route.path) === JSON.stringify(state.currentRoute);
                
                // Format distance to km with 1 decimal place
                const distanceKm = (route.distance / 1000).toFixed(1);
                
                // Format duration to minutes or hours and minutes
                let durationText;
                const totalMinutes = Math.ceil(route.duration / 60);
                
                if (totalMinutes >= 60) {
                    const hours = Math.floor(totalMinutes / 60);
                    const mins = totalMinutes % 60;
                    durationText = `${hours} hr ${mins} min`;
                } else {
                    durationText = `${totalMinutes} min`;
                }
                
                // Get safety score info if available
                let safetyScore = 0;
                let safetyRating = 'Unknown';
                let safetyClass = '';
                
                if (route.safetyScore) {
                    safetyScore = route.safetyScore.score || 0;
                    safetyRating = route.safetyScore.rating || 'Unknown';
                    
                    // Determine safety class for styling
                    if (safetyScore >= 80) {
                        safetyClass = 'safety-excellent';
                    } else if (safetyScore >= 60) {
                        safetyClass = 'safety-good';
                    } else if (safetyScore >= 40) {
                        safetyClass = 'safety-moderate';
                    } else if (safetyScore >= 20) {
                        safetyClass = 'safety-poor';
                    } else {
                        safetyClass = 'safety-verypoor';
                    }
                }
                
                // Create the route option element
                const optionEl = document.createElement('div');
                optionEl.className = `route-option${isSelected ? ' selected' : ''}`;
                optionEl.dataset.routeIndex = index;
                
                optionEl.innerHTML = `
                    <div class="route-option-header">
                        <div class="route-option-title">${route.name || `Route ${index + 1}`}</div>
                        <div class="safety-pill ${safetyClass}">
                            <span>${safetyScore}</span>
                        </div>
                    </div>
                    <div class="route-option-details">
                        <div class="route-option-detail">
                            <span class="detail-label">Distance</span>
                            <span class="detail-value">${distanceKm} km</span>
                        </div>
                        <div class="route-option-detail">
                            <span class="detail-label">Duration</span>
                            <span class="detail-value">${durationText}</span>
                        </div>
                        <div class="route-option-detail">
                            <span class="detail-label">Safety</span>
                            <span class="detail-value">${safetyRating}</span>
                        </div>
                    </div>
                `;
                
                // Add click handler to select this route
                optionEl.addEventListener('click', () => {
                    selectRouteOption(index);
                });
                
                container.appendChild(optionEl);
            });
        } catch (error) {
            console.error("Error updating route options panel:", error);
            const container = document.getElementById('route-options-container');
            if (container) {
                container.innerHTML = '<p class="route-options-hint">Error displaying route options</p>';
            }
        }
    }
    
    // Function to select a route option by index
    function selectRouteOption(index) {
        try {
            if (!state.routeAlternatives || index < 0 || index >= state.routeAlternatives.length) {
                console.error("Invalid route option index:", index);
                return;
            }
            
            const selectedRoute = state.routeAlternatives[index];
            
            // Update the current route in state
            state.currentRoute = selectedRoute.path;
            
            // Update the route on the map
            updateRouteOnMap(selectedRoute.path);
            
            // Update route information display
            displayRouteInfo(selectedRoute.distance, selectedRoute.duration);
            
            // Update safety score if available
            if (selectedRoute.safetyScore) {
                updateRouteSafetyScore(selectedRoute.safetyScore);
            }
            
            // Update crime markers if they're visible
            if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function') {
                window.updateCrimeMarkersForRoute(selectedRoute.path).catch(error => {
                    console.warn('Non-critical error updating crime markers:', error);
                });
            }
            
            // Update route options panel to reflect the new selection
            updateRouteOptionsPanel(state.routeAlternatives);
            
            // Update crime time panel if it's available
            if (typeof updateCrimeTimePanel === 'function') {
                updateCrimeTimePanel(selectedRoute.path);
            }
        } catch (error) {
            console.error("Error selecting route option:", error);
        }
    }

    // New function to update the safety score based on filtered data analyzed by the AI bot
    function updateRouteSafetyScore(safetyData) {
        // Find the safety score container
        const safetyScoreContainer = document.getElementById('safety-score-container');
        if (!safetyScoreContainer) return;
        
        try {
            // Extract data from the safety analysis
            const { score, rating, details } = safetyData;
            
            // Get color based on score
            let scoreColor = '#999'; // Default gray
            if (score >= 80) {
                scoreColor = '#4CAF50'; // Green for excellent
            } else if (score >= 60) {
                scoreColor = '#8BC34A'; // Light green for good
            } else if (score >= 40) {
                scoreColor = '#FFC107'; // Amber for moderate
            } else if (score >= 20) {
                scoreColor = '#FF9800'; // Orange for poor
            } else if (score > 0) {
                scoreColor = '#F44336'; // Red for very poor
            }
            
            // Update the safety score display
            safetyScoreContainer.innerHTML = `
                <span class="info-label">Safety Score:</span>
                <span class="info-value">
                    <span class="safety-score" style="color: ${scoreColor};">
                        ${score}
                    </span>
                    <span class="safety-rating">${rating}</span>
                </span>
            `;
            
            // Add tooltip with additional details (if provided)
            if (details) {
                const tooltipContent = `
                    <div class="safety-tooltip">
                        <h4>Safety Details</h4>
                        ${details.lighting !== undefined ? `
                        <div class="safety-detail">
                            <span>Lighting:</span> 
                            <span>${details.lighting}/100</span>
                        </div>` : ''}
                        ${details.crimeRisk !== undefined ? `
                        <div class="safety-detail">
                            <span>Crime Risk:</span> 
                            <span>${details.crimeRisk}/100</span>
                        </div>` : ''}
                        ${details.policeProximity !== undefined ? `
                        <div class="safety-detail">
                            <span>Police Proximity:</span> 
                            <span>${details.policeProximity}/10</span>
                        </div>` : ''}
                        ${details.lampsCount !== undefined ? `
                        <div class="safety-detail small">
                            <span>Street Lamps:</span> 
                            <span>${details.lampsCount} (${details.lampsPerKm || '0'}/km)</span>
                        </div>` : ''}
                        ${details.crimeIncidents !== undefined ? `
                        <div class="safety-detail small">
                            <span>Crime Incidents:</span> 
                            <span>${details.crimeIncidents} (${details.crimeIncidentsPerKm || '0'}/km)</span>
                        </div>` : ''}
                    </div>
                `;
                
                // Add tooltip functionality (hover to show details)
                const safetyScore = safetyScoreContainer.querySelector('.safety-score');
                if (safetyScore) {
                    safetyScore.title = "Hover for details";
                    safetyScore.setAttribute('data-tooltip', tooltipContent);
                    
                    // Add tooltip element
                    let tooltipEl = document.getElementById('safety-tooltip');
                    if (!tooltipEl) {
                        tooltipEl = document.createElement('div');
                        tooltipEl.id = 'safety-tooltip';
                        tooltipEl.className = 'tooltip';
                        tooltipEl.style.display = 'none';
                        document.body.appendChild(tooltipEl);
                    }
                    
                    // Show tooltip on hover
                    safetyScore.addEventListener('mouseenter', function(e) {
                        tooltipEl.innerHTML = this.getAttribute('data-tooltip');
                        tooltipEl.style.display = 'block';
                        
                        // Position tooltip near the score
                        const rect = this.getBoundingClientRect();
                        tooltipEl.style.left = rect.left + 'px';
                        tooltipEl.style.top = (rect.bottom + 10) + 'px';
                    });
                    
                    safetyScore.addEventListener('mouseleave', function() {
                        tooltipEl.style.display = 'none';
                    });
                }
            }
        } catch (error) {
            console.error('Error updating safety score:', error);
            safetyScoreContainer.innerHTML = `
                <span class="info-label">Safety Score:</span>
                <span class="info-value">Error calculating</span>
            `;
        }
    }

    // Calculate safety score based on filtered data from AI chat analysis
    function calculateFilteredSafetyScore() {
        try {
            // Only calculate if we have data
            if (!state.filteredSafetyData) {
                return {
                    score: 0,
                    rating: 'No Data'
                };
            }
            
            // Extract data from state
            const { filteredSafetyData } = state;
            const lightingFactor = filteredSafetyData.lightingData ? 
                parseFloat(filteredSafetyData.lightingData.coveragePercentage) / 100 : 0.5;
            
            const crimeCount = filteredSafetyData.crimeData ? 
                filteredSafetyData.crimeData.count : 0;
            
            // Calculate route length in km
            const routeLength = filteredSafetyData.lightingData && filteredSafetyData.lightingData.routeLength ? 
                parseFloat(filteredSafetyData.lightingData.routeLength) / 1000 : 1;
            
            const crimePerKm = crimeCount / routeLength;
            
            // Calculate crime factor (0-1, lower is better)
            let crimeFactor;
            if (crimePerKm === 0) {
                crimeFactor = 1.0; // No crime = perfect score
            } else if (crimePerKm <= 0.5) {
                crimeFactor = 0.9; // Very few incidents
            } else if (crimePerKm <= 2) {
                crimeFactor = 0.7; // Moderate incidents
            } else if (crimePerKm <= 5) {
                crimeFactor = 0.4; // Many incidents
            } else {
                crimeFactor = 0.2; // Extremely high crime
            }
            
            // Calculate combined score (0-100)
            const score = Math.round((lightingFactor * 0.4 + crimeFactor * 0.6) * 100);
            
            // Get rating text
            let rating = 'Unknown';
            if (score >= 80) {
                rating = 'Excellent';
            } else if (score >= 60) {
                rating = 'Good';
            } else if (score >= 40) {
                rating = 'Moderate';
            } else if (score >= 20) {
                rating = 'Poor';
            } else {
                rating = 'Very Poor';
            }
            
            return {
                score,
                rating
            };
        } catch (error) {
            console.error('Error calculating filtered safety score:', error);
            return {
                score: 0,
                rating: 'Error'
            };
        }
    }

    // Expose these functions globally so they can be called from the chat interface
    window.updateRouteSafetyScore = updateRouteSafetyScore;
    window.calculateFilteredSafetyScore = calculateFilteredSafetyScore;

    // Function to update safety score based on filtered data
    window.updateSafetyScoreFromFiltered = function() {
        try {
            const safetyData = calculateFilteredSafetyScore();
            updateRouteSafetyScore(safetyData);
            return safetyData;
        } catch (error) {
            console.error("Error updating safety score from filtered data:", error);
            return null;
        }
    }

    // Search for POIs function
    async function searchPOIs() {
        const query = poiSearchInput.value.trim();
        
        if (!query) {
            showError('Please enter a search term');
            return;
        }
        
        showLoading(true);
        
        try {
            // Get current map center for location bias
            const center = map.getCenter();
            
            // Get current map bounds to constrain search results
            const bounds = map.getBounds();
            const mapBounds = [
                [bounds.getWest(), bounds.getSouth()], // southwest
                [bounds.getEast(), bounds.getNorth()]  // northeast
            ];
            
            const response = await fetch('/proxy_place_search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: query,
                    location: [center.lat, center.lng],
                    bounds: mapBounds
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Deduplicate places by location
                const uniqueLocations = new Set();
                const uniquePlaces = data.places.filter(place => {
                    const locationKey = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
                    if (!uniqueLocations.has(locationKey)) {
                        uniqueLocations.add(locationKey);
                        return true;
                    }
                    return false;
                });
                
                // Save places as POIs
                state.pois = uniquePlaces;
                state.selectedPois = [];
                
                // Update POI list in sidebar
                updatePoiList(uniquePlaces);
                
                // Update POIs on map
                updatePoisOnMap(uniquePlaces);
                
                // Enable adjust route button if we have places
                adjustRouteBtn.disabled = uniquePlaces.length === 0;
                
                // Show success message
                if (uniquePlaces.length > 0) {
                    showNotification(`Found ${uniquePlaces.length} places matching "${query}" within the current map view`, 'info');
                    
                    // Fit the map to show all POIs
                    fitMapToPois(uniquePlaces);
                } else {
                    showNotification(`No places found matching "${query}" within the current map view. Try zooming out or a different search term.`, 'info');
                }
            } else {
                showError(`Search failed: ${data.error}`);
            }
        } catch (error) {
            showError(`Network error: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }

    // Fit the map to show all POIs
    function fitMapToPois(pois) {
        if (!pois || pois.length === 0) return;
        
        // Create bounds
        const bounds = new mapboxgl.LngLatBounds();
        
        // Add each POI to the bounds
        pois.forEach(poi => {
            bounds.extend([poi.lng, poi.lat]);
        });
        
        // Add some padding to the bounds
        map.fitBounds(bounds, {
            padding: 50,
            maxZoom: 15
        });
    }

    function updatePoiList(pois) {
        // Get or create POI list container
        let poiListContainer = document.getElementById('poi-list');
        if (!poiListContainer) {
            poiListContainer = document.createElement('div');
            poiListContainer.id = 'poi-list';
            poiListContainer.className = 'poi-list';
            
            // Insert it in the appropriate place
            const filterGroup = document.querySelector('.filter-group');
            filterGroup.appendChild(poiListContainer);
        }
        
        // Clear existing content
        poiListContainer.innerHTML = '';
        
        if (pois.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'poi-empty';
            emptyMessage.textContent = 'No places found. Ask the assistant to find places for you.';
            poiListContainer.appendChild(emptyMessage);
            return;
        }
        
        // Create list items for each POI
        pois.forEach(poi => {
            const poiItem = document.createElement('div');
            poiItem.className = 'poi-item';
            poiItem.dataset.id = poi.id;
            
            const poiName = document.createElement('div');
            poiName.className = 'poi-name';
            poiName.textContent = poi.name;
            
            // Only show address if it exists and is not too long
            if (poi.address && poi.address.length > 0) {
                const poiAddress = document.createElement('div');
                poiAddress.className = 'poi-address';
                // Truncate address if it's too long
                poiAddress.textContent = poi.address.length > 50 ? 
                    poi.address.substring(0, 50) + '...' : 
                    poi.address;
                poiItem.appendChild(poiAddress);
            }
            
            // Only show description if it exists
            if (poi.description && poi.description.length > 0) {
                const poiDesc = document.createElement('div');
                poiDesc.className = 'poi-description';
                // Truncate description if it's too long
                poiDesc.textContent = poi.description.length > 60 ? 
                    poi.description.substring(0, 60) + '...' : 
                    poi.description;
                poiItem.appendChild(poiDesc);
            }
            
            poiItem.appendChild(poiName);
            
            // Add click event to select/deselect
            poiItem.addEventListener('click', function() {
                togglePoiSelection(poi.id);
            });
            
            poiListContainer.appendChild(poiItem);
        });
        
        // No longer adding hint text
    }

    function togglePoiSelection(poiId) {
        const index = state.selectedPois.indexOf(poiId);
        
        if (index === -1) {
            // Add to selected
            state.selectedPois.push(poiId);
        } else {
            // Remove from selected
            state.selectedPois.splice(index, 1);
        }
        
        // Update POI item in list
        const poiItem = document.querySelector(`.poi-item[data-id="${poiId}"]`);
        if (poiItem) {
            poiItem.classList.toggle('selected', index === -1);
        }
        
        // Update POIs on map to reflect selection state
        updatePoisOnMap(state.pois);
        
        // Enable/disable adjust route button
        adjustRouteBtn.disabled = state.selectedPois.length === 0;
    }

    // Add this function to update POIs on the map
    function updatePoisOnMap(pois) {
        // Create features for POIs
        const features = pois.map(poi => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [poi.lng, poi.lat]
            },
            properties: {
                id: poi.id,
                name: poi.name,
                description: poi.description || '',
                type: poi.type || 'custom',
                selected: window.state.selectedPois.includes(poi.id)
            }
        }));
        
        // Update POIs layer data
        const poisSource = map.getSource('pois');
        if (poisSource) {
            poisSource.setData({
                type: 'FeatureCollection',
                features: features
            });
        }
        
        // Fit map to show all POIs if there are any
        if (features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            features.forEach(feature => {
                bounds.extend(feature.geometry.coordinates);
            });
            
            map.fitBounds(bounds, {
                padding: 80,
                maxZoom: 15
            });
        }
    }

    // Initialize the POI list
    document.addEventListener('DOMContentLoaded', function() {
        // Initialize the POI list with an empty message
        window.updatePoiList([]);
    });

    // Function to toggle traffic signals
    async function toggleTrafficSignals() {
        const toggleBtn = document.getElementById('toggle-traffic-signals');
        
        // Toggle visibility state
        trafficSignalsVisible = !trafficSignalsVisible;
        
        // Toggle active class on button
        toggleBtn.classList.toggle('active', trafficSignalsVisible);
        
        // Set visibility of the layers
        const visibility = trafficSignalsVisible ? 'visible' : 'none';
        map.setLayoutProperty('traffic-signals', 'visibility', visibility);
        map.setLayoutProperty('traffic-signal-halos', 'visibility', visibility);
        
        // If traffic signals are being shown and haven't been loaded yet, fetch them
        if (trafficSignalsVisible && !trafficSignalsLoaded) {
            toggleBtn.disabled = true;
            toggleBtn.textContent = 'Loading...';
            
            try {
                await fetchTrafficSignals();
                trafficSignalsLoaded = true;
            } catch (error) {
                console.error('Error fetching traffic signals:', error);
                showError('Failed to load traffic signals');
                trafficSignalsVisible = false;
                toggleBtn.classList.remove('active');
                map.setLayoutProperty('traffic-signals', 'visibility', 'none');
                map.setLayoutProperty('traffic-signal-halos', 'visibility', 'none');
            } finally {
                toggleBtn.disabled = false;
                toggleBtn.textContent = 'Traffic Signals';
            }
        }
    }
    
    // Function to fetch traffic signals from OpenStreetMap
    async function fetchTrafficSignals() {
        // Central Sydney area bounding box (extended south to include Mascot)
        const bbox = '-33.95,151.15,-33.85,151.25';
        
        // Construct Overpass API query to get traffic signals
        const query = `
            [out:json];
            (
              node["highway"="traffic_signals"](${bbox});
            );
            out body;
        `;
        
        // Fetch traffic signals data from Overpass API
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch traffic signals data');
        }
        
        const data = await response.json();
        
        // Convert OSM data to GeoJSON features
        const features = data.elements.map(element => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [element.lon, element.lat]
            },
            properties: {
                id: element.id,
                tags: element.tags
            }
        }));
        
        // Filter traffic signals to remove those in close proximity
        const filteredFeatures = filterProximateSignals(features);
        
        // Store all traffic signals (both original and filtered)
        allTrafficSignals = filteredFeatures;
        filteredTrafficSignals = [...filteredFeatures]; // Initialize filtered to all signals
        
        // Update the traffic signals source with the filtered features
        const trafficSignalsSource = map.getSource('traffic-signals');
        if (trafficSignalsSource) {
            trafficSignalsSource.setData({
                type: 'FeatureCollection',
                features: filteredFeatures
            });
        }
        
        // Show notification with count
        showNotification(`Loaded ${filteredFeatures.length} traffic signals (condensed from ${features.length})`, 'info');
    }
    
    // Function to filter traffic signals in close proximity to each other
    function filterProximateSignals(signals) {
        // Define the proximity threshold in meters
        const proximityThreshold = 40; // Consider signals within 40m as same intersection
        
        // Create an array to hold filtered signals
        const filteredSignals = [];
        // Create a set to track which signals have been processed
        const processedIds = new Set();
        
        // Process each signal
        signals.forEach(signal => {
            // Skip if already processed
            if (processedIds.has(signal.properties.id)) {
                return;
            }
            
            // Create a Leaflet latLng for the current signal
            const signalLatLng = L.latLng(
                signal.geometry.coordinates[1], 
                signal.geometry.coordinates[0]
            );
            
            // Find all signals within the proximity threshold
            const proximate = signals.filter(otherSignal => {
                // Skip if same signal
                if (otherSignal.properties.id === signal.properties.id) {
                    return false;
                }
                
                // Create a Leaflet latLng for the other signal
                const otherLatLng = L.latLng(
                    otherSignal.geometry.coordinates[1], 
                    otherSignal.geometry.coordinates[0]
                );
                
                // Calculate distance between signals
                const distance = signalLatLng.distanceTo(otherLatLng);
                
                // Return true if within proximity threshold
                return distance <= proximityThreshold;
            });
            
            // Add the current signal to filtered list
            filteredSignals.push(signal);
            
            // Mark the current signal and all proximate signals as processed
            processedIds.add(signal.properties.id);
            proximate.forEach(p => processedIds.add(p.properties.id));
        });
        
        return filteredSignals;
    }

    // Function to toggle crime markers
    async function toggleCrimeMarkers() {
        const toggleBtn = document.getElementById('toggle-crime');
        
        // Toggle visibility state
        crimeMarkersVisible = !crimeMarkersVisible;
        
        // Toggle active class on button
        toggleBtn.classList.toggle('active', crimeMarkersVisible);
        
        if (crimeMarkersVisible) {
            // Show loading state
            toggleBtn.disabled = true;
            toggleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            
            try {
                // Load crime data if not already loaded
                if (!crimeMarkersLoaded) {
                    await fetchCrimeData();
                    crimeMarkersLoaded = true;
                }
                
                // Reset any crime markers filtering that might have been applied
                if (window.resetCrimeMarkersFilter && typeof window.resetCrimeMarkersFilter === 'function') {
                    window.resetCrimeMarkersFilter();
                } else if (window._originalCrimeData && map.getSource('crime-data')) {
                    // Fallback if the function isn't available
                    map.getSource('crime-data').setData(window._originalCrimeData);
                }
                
                // Show all crime layers
                map.setLayoutProperty('crime-clusters', 'visibility', 'visible');
                map.setLayoutProperty('crime-cluster-count', 'visibility', 'visible');
                map.setLayoutProperty('crime-markers', 'visibility', 'visible');
                
            } catch (error) {
                console.error('Error loading crime data:', error);
                showError('Failed to load crime data');
                crimeMarkersVisible = false;
                toggleBtn.classList.remove('active');
            } finally {
                toggleBtn.disabled = false;
                toggleBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Crime Locations';
            }
        } else {
            // Hide all crime layers
            map.setLayoutProperty('crime-clusters', 'visibility', 'none');
            map.setLayoutProperty('crime-cluster-count', 'visibility', 'none');
            map.setLayoutProperty('crime-markers', 'visibility', 'none');
        }
    }
    
    // Function to fetch crime data from external source
    async function fetchCrimeData() {
        try {
            // Use our Flask endpoint to get the crime data
            const response = await fetch('/crime_data');
            
            if (!response.ok) {
                throw new Error('Crime data file not found');
            }
            
            const csvText = await response.text();
            
            // Parse CSV
            const rows = csvText.split('\n').map(row => row.split(','));
            const headers = rows[0];
            
            // Convert rows to objects - handle all valid entries
            const parsedData = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < headers.length) continue; // Skip incomplete rows
                
                const rowData = {};
                headers.forEach((header, index) => {
                    rowData[header.trim()] = row[index]?.trim();
                });
                parsedData.push(rowData);
            }
            
            crimeData = parsedData;
            
            console.log('Crime data loaded successfully:', crimeData.length, 'records');
            
            // Filter for records with valid coordinates
            const validRecords = crimeData.filter(record => {
                const lat = parseFloat(record.bcsrgclat || record.Latitude);
                const lng = parseFloat(record.bcsrgclng || record.Longitude);
                return !isNaN(lat) && !isNaN(lng);
            });
            
            if (validRecords.length === 0) {
                throw new Error('No valid crime records found with coordinates');
            }
            
            // Create GeoJSON features from the records
            const features = validRecords.map(record => {
                const lat = parseFloat(record.bcsrgclat || record.Latitude);
                const lng = parseFloat(record.bcsrgclng || record.Longitude);
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    properties: {
                        ...record,
                        description: `${record.bcsrcat || record.OffenceCategory || 'Crime incident'}`
                    }
                };
            });
            
            // Store raw features for use with filtering
            window._rawCrimeFeatures = [...features];
            
            // Add the crime data to the map
            if (!map.getSource('crime-data')) {
                // If the source doesn't exist yet, create it
                map.addSource('crime-data', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: features
                    },
                    cluster: true,
                    clusterMaxZoom: 14,
                    clusterRadius: 50
                });
                
                // Add a layer for the clusters
                map.addLayer({
                    id: 'crime-clusters',
                    type: 'circle',
                    source: 'crime-data',
                    filter: ['has', 'point_count'],
                    paint: {
                        'circle-color': 'rgba(180, 0, 0, 0.9)',
                        'circle-radius': [
                            'step',
                            ['get', 'point_count'],
                            18,  // radius for smaller clusters
                            20, 24,  // medium clusters
                            50, 30   // large clusters
                        ],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': 'rgba(255, 255, 255, 0.8)'
                    }
                });
                
                // Add a layer for the cluster counts
                map.addLayer({
                    id: 'crime-cluster-count',
                    type: 'symbol',
                    source: 'crime-data',
                    filter: ['has', 'point_count'],
                    layout: {
                        'text-field': '{point_count_abbreviated}',
                        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                        'text-size': 14
                    },
                    paint: {
                        'text-color': '#ffffff',
                        'text-halo-color': 'rgba(0, 0, 0, 0.2)',
                        'text-halo-width': 1
                    }
                });
                
                // Add a layer for individual crime points
                map.addLayer({
                    id: 'crime-markers',
                    type: 'circle',
                    source: 'crime-data',
                    filter: ['!', ['has', 'point_count']],
                    paint: {
                        'circle-color': 'rgba(220, 20, 60, 0.8)',
                        'circle-radius': 7,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': 'rgba(255, 255, 255, 0.8)'
                    }
                });
                
                // Hide the layers by default
                map.setLayoutProperty('crime-clusters', 'visibility', 'none');
                map.setLayoutProperty('crime-cluster-count', 'visibility', 'none');
                map.setLayoutProperty('crime-markers', 'visibility', 'none');
                
                // Add click event for clusters to zoom in
                map.on('click', 'crime-clusters', (e) => {
                    const features = map.queryRenderedFeatures(e.point, { layers: ['crime-clusters'] });
                    const clusterId = features[0].properties.cluster_id;
                    
                    map.getSource('crime-data').getClusterExpansionZoom(
                        clusterId,
                        (err, zoom) => {
                            if (err) return;
                            
                            map.easeTo({
                                center: features[0].geometry.coordinates,
                                zoom: zoom
                            });
                        }
                    );
                });
                
                // Add click event for individual crime points to show popup
                map.on('click', 'crime-markers', (e) => {
                    const coordinates = e.features[0].geometry.coordinates.slice();
                    const properties = e.features[0].properties;
                    
                    // Build popup content
                    let popupContent = '<div style="max-width: 300px;">';
                    popupContent += '<h3 style="margin: 0 0 8px; color: #d32f2f;">Crime Incident</h3>';
                    
                    if (properties.bcsrcat || properties.OffenceCategory) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Category:</strong> ${properties.bcsrcat || properties.OffenceCategory}</p>`;
                    }
                    
                    if (properties.bcsrgrp || properties.OffenceType) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Type:</strong> ${properties.bcsrgrp || properties.OffenceType}</p>`;
                    }
                    
                    if (properties.lganame || properties.LGA) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Area:</strong> ${properties.lganame || properties.LGA}</p>`;
                    }
                    
                    if (properties.locsurb || properties.Suburb) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Suburb:</strong> ${properties.locsurb || properties.Suburb}</p>`;
                    }
                    
                    if (properties.incyear || properties.Year) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Year:</strong> ${properties.incyear || properties.Year}</p>`;
                    }
                    
                    if (properties.incmonth || properties.Month) {
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Month:</strong> ${properties.incmonth || properties.Month}</p>`;
                    }
                    
                    // Add the new fields with correct property IDs
                    popupContent += `<p style="margin: 0 0 4px;"><strong>Time:</strong> ${properties.incsttm || properties.Time || "Not Applicable"}</p>`;
                    popupContent += `<p style="margin: 0 0 4px;"><strong>Sex:</strong> ${properties.poisex || properties.Sex || "Not Applicable"}</p>`;
                    popupContent += `<p style="margin: 0 0 4px;"><strong>Age:</strong> ${properties.poi_age || properties.Age || "Not Applicable"}</p>`;
                    
                    popupContent += '</div>';
                    
                    // Create popup
                    new mapboxgl.Popup()
                        .setLngLat(coordinates)
                        .setHTML(popupContent)
                        .addTo(map);
                });
                
                // Change cursor to pointer when hovering over clusters or markers
                map.on('mouseenter', 'crime-clusters', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                
                map.on('mouseleave', 'crime-clusters', () => {
                    map.getCanvas().style.cursor = '';
                });
                
                map.on('mouseenter', 'crime-markers', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                
                map.on('mouseleave', 'crime-markers', () => {
                    map.getCanvas().style.cursor = '';
                });
            } else {
                // If the source already exists, update the data
                map.getSource('crime-data').setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
            
            // Show all crime layers
            map.setLayoutProperty('crime-clusters', 'visibility', 'visible');
            map.setLayoutProperty('crime-cluster-count', 'visibility', 'visible');
            map.setLayoutProperty('crime-markers', 'visibility', 'visible');
            
            showNotification(`Loaded ${validRecords.length} crime incidents`, 'info');
            return validRecords;
        } catch (error) {
            console.error('Error loading crime data:', error);
            
            // Try to use mock data if real data isn't available
            const mockData = generateMockCrimeData();
            
            if (mockData.length > 0) {
                showNotification('Using sample crime data for demonstration', 'info');
                
                // Create GeoJSON features from mock data
                const features = mockData.map(record => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [record.lng, record.lat]
                    },
                    properties: {
                        ...record,
                        description: record.type
                    }
                }));
                
                // Add the mock data to the map
                if (!map.getSource('crime-data')) {
                    // Create new source and layers (similar to above)
                    map.addSource('crime-data', {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: features
                        },
                        cluster: true,
                        clusterMaxZoom: 14,
                        clusterRadius: 50
                    });
                    
                    // Add the same layers as above
                    // (This is duplicate code for brevity - in production, this should be a function)
                    map.addLayer({
                        id: 'crime-clusters',
                        type: 'circle',
                        source: 'crime-data',
                        filter: ['has', 'point_count'],
                        paint: {
                            'circle-color': 'rgba(180, 0, 0, 0.9)',
                            'circle-radius': [
                                'step',
                                ['get', 'point_count'],
                                18,  // radius for smaller clusters
                                20, 24,  // medium clusters
                                50, 30   // large clusters
                            ],
                            'circle-stroke-width': 2,
                            'circle-stroke-color': 'rgba(255, 255, 255, 0.8)'
                        }
                    });
                    
                    map.addLayer({
                        id: 'crime-cluster-count',
                        type: 'symbol',
                        source: 'crime-data',
                        filter: ['has', 'point_count'],
                        layout: {
                            'text-field': '{point_count_abbreviated}',
                            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                            'text-size': 14
                        },
                        paint: {
                            'text-color': '#ffffff',
                            'text-halo-color': 'rgba(0, 0, 0, 0.2)',
                            'text-halo-width': 1
                        }
                    });
                    
                    map.addLayer({
                        id: 'crime-markers',
                        type: 'circle',
                        source: 'crime-data',
                        filter: ['!', ['has', 'point_count']],
                        paint: {
                            'circle-color': 'rgba(220, 20, 60, 0.8)',
                            'circle-radius': 7,
                            'circle-stroke-width': 2,
                            'circle-stroke-color': 'rgba(255, 255, 255, 0.8)'
                        }
                    });
                    
                    // Add the same event listeners as above
                    // (Again, this should be a function in production code)
                    map.on('click', 'crime-clusters', (e) => {
                        const features = map.queryRenderedFeatures(e.point, { layers: ['crime-clusters'] });
                        const clusterId = features[0].properties.cluster_id;
                        
                        map.getSource('crime-data').getClusterExpansionZoom(
                            clusterId,
                            (err, zoom) => {
                                if (err) return;
                                
                                map.easeTo({
                                    center: features[0].geometry.coordinates,
                                    zoom: zoom
                                });
                            }
                        );
                    });
                    
                    map.on('click', 'crime-markers', (e) => {
                        const coordinates = e.features[0].geometry.coordinates.slice();
                        const properties = e.features[0].properties;
                        
                        // Build popup content
                        let popupContent = '<div style="max-width: 300px;">';
                        popupContent += '<h3 style="margin: 0 0 8px; color: #d32f2f;">Crime Incident</h3>';
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Type:</strong> ${properties.type}</p>`;
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Date:</strong> ${properties.date}</p>`;
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Time:</strong> ${properties.time || properties.incsttm || "Not Applicable"}</p>`;
                        
                        // Add the new fields with correct property IDs
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Sex:</strong> ${properties.poisex || properties.sex || "Not Applicable"}</p>`;
                        popupContent += `<p style="margin: 0 0 4px;"><strong>Age:</strong> ${properties.poi_age || properties.age || "Not Applicable"}</p>`;
                        
                        popupContent += '</div>';
                        
                        new mapboxgl.Popup()
                            .setLngLat(coordinates)
                            .setHTML(popupContent)
                            .addTo(map);
                    });
                    
                    map.on('mouseenter', 'crime-clusters', () => {
                        map.getCanvas().style.cursor = 'pointer';
                    });
                    
                    map.on('mouseleave', 'crime-clusters', () => {
                        map.getCanvas().style.cursor = '';
                    });
                    
                    map.on('mouseenter', 'crime-markers', () => {
                        map.getCanvas().style.cursor = 'pointer';
                    });
                    
                    map.on('mouseleave', 'crime-markers', () => {
                        map.getCanvas().style.cursor = '';
                    });
                } else {
                    // Update the existing source
                    map.getSource('crime-data').setData({
                        type: 'FeatureCollection',
                        features: features
                    });
                }
                
                // Show all crime layers
                map.setLayoutProperty('crime-clusters', 'visibility', 'visible');
                map.setLayoutProperty('crime-cluster-count', 'visibility', 'visible');
                map.setLayoutProperty('crime-markers', 'visibility', 'visible');
                
                return mockData;
            } else {
                throw new Error('Could not load crime data');
            }
        }
    }
    
    // Function to generate mock crime data for demo purposes
    function generateMockCrimeData() {
        const mockData = [];
        const sydneyArea = {
            lat: -33.868820, 
            lng: 151.209296,
            radius: 0.05
        };
        
        // Crime types for variety
        const crimeTypes = [
            'Robbery', 'Theft', 'Assault', 'Burglary', 
            'Vandalism', 'Car Theft', 'Drug Offense',
            'Public Disorder', 'Shoplifting'
        ];
            
        // Generate random dates within the last year
            const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        // Create times for each part of the day to ensure good distribution
        const timesOfDay = [
            // Morning
            '6:00', '7:15', '8:30', '9:45', '10:30', '11:15',
            // Afternoon 
            '12:00', '13:30', '14:45', '15:15', '16:30', '17:45',
            // Evening
            '18:15', '19:30', '20:00', '21:15',
            // Night
            '22:30', '23:45', '0:15', '1:30', '2:45', '4:15', '5:30'
        ];
            
        // Generate 100 random crime points
        for (let i = 0; i < 100; i++) {
            // Random angle and distance
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * sydneyArea.radius;
            
            // Calculate position
            const lat = sydneyArea.lat + (Math.sin(angle) * distance);
            const lng = sydneyArea.lng + (Math.cos(angle) * distance);
            
            // Random crime type
            const typeIndex = Math.floor(Math.random() * crimeTypes.length);
            const type = crimeTypes[typeIndex];
            
            // Random date in the last year
            const randomTime = oneYearAgo.getTime() + Math.random() * (now.getTime() - oneYearAgo.getTime());
            const date = new Date(randomTime);
            const dateString = date.toISOString().split('T')[0];
            
            // Assign a time of day to ensure good distribution across categories
            const timeIndex = Math.floor(Math.random() * timesOfDay.length);
            const time = timesOfDay[timeIndex];
            
            // Create mock crime data
            mockData.push({
                id: `mock-crime-${i}`,
                type: type,
                lat: lat,
                lng: lng,
                date: dateString,
                time: time,
                description: `Mock ${type} incident`,
            });
        }
        
        return mockData;
    }

    // Make functions available globally
    window.state = state;
    window.updateCustomPointsOnMap = updateCustomPointsOnMap;
    window.updatePoiList = updatePoiList;
    window.togglePoiSelection = togglePoiSelection;
    window.updateMarkers = updateMarkers;
    window.updatePoisOnMap = updatePoisOnMap;

    // Function to deactivate marker placement mode
    function deactivateMarkerPlacementMode() {
        if (markerPlacementMode) {
            markerPlacementMode = null;
            map.getCanvas().style.cursor = '';
            document.body.classList.remove('marker-placement-active');
            startAddressInput.classList.remove('active-input');
            endAddressInput.classList.remove('active-input');
            clearError();
        }
    }
    
    // Listen for escape key to cancel marker placement
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && markerPlacementMode) {
            deactivateMarkerPlacementMode();
            showNotification('Marker placement canceled', 'info');
        }
    });
    
    // Listen for clicks outside the map to cancel marker placement
    document.addEventListener('click', function(e) {
        // Check if click is outside the map and outside the input fields
        if (markerPlacementMode && 
            !e.target.closest('#map') && 
            e.target !== startAddressInput && 
            e.target !== endAddressInput) {
            deactivateMarkerPlacementMode();
        }
    });

    // Function to fetch address suggestions
    async function fetchAddressSuggestions(query, type) {
        if (!query) return;
        
        try {
            const response = await fetch('/geocode_autocomplete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    query: query,
                    location: [-33.8688, 151.2093], // Sydney coordinates for location bias
                    country: 'au', // Australia country code
                    region: 'nsw' // New South Wales region
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Update suggestions in state
                if (type === 'start') {
                    state.startAddressSuggestions = data.suggestions;
                    renderSuggestions(data.suggestions, 'start');
                } else {
                    state.endAddressSuggestions = data.suggestions;
                    renderSuggestions(data.suggestions, 'end');
                }
            } else {
                console.error('Error fetching suggestions:', data.error);
            }
        } catch (error) {
            console.error('Network error fetching suggestions:', error);
        }
    }
    
    // Function to render suggestions in the dropdown
    function renderSuggestions(suggestions, type) {
        const dropdown = type === 'start' ? startAutocompleteDropdown : endAutocompleteDropdown;
        
        // Clear existing suggestions
        dropdown.innerHTML = '';
        
        if (suggestions.length === 0) {
            dropdown.classList.remove('show');
            return;
        }
        
        // Create suggestion items
        suggestions.forEach((suggestion, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.dataset.index = index;
            
            // Show the full address without truncation
            item.textContent = suggestion.name;
            
            // Add click handler
            item.addEventListener('click', function() {
                selectSuggestion(suggestion, type);
            });
            
            dropdown.appendChild(item);
        });
        
        // Show the dropdown
        dropdown.classList.add('show');
        
        // Reset selected index
        state.selectedSuggestionIndex = -1;
    }
    
    // Function to update the selected suggestion highlighting
    function updateSelectedSuggestion(type) {
        const dropdown = type === 'start' ? startAutocompleteDropdown : endAutocompleteDropdown;
        const items = dropdown.querySelectorAll('.autocomplete-item');
        
        // Remove selected class from all items
        items.forEach(item => item.classList.remove('selected'));
        
        // Add selected class to current item
        if (state.selectedSuggestionIndex >= 0 && state.selectedSuggestionIndex < items.length) {
            items[state.selectedSuggestionIndex].classList.add('selected');
            
            // Scroll item into view if needed
            items[state.selectedSuggestionIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }
    
    // Function to handle suggestion selection
    function selectSuggestion(suggestion, type) {
        if (type === 'start') {
            startAddressInput.value = suggestion.name;
            startAutocompleteDropdown.classList.remove('show');
        } else {
            endAddressInput.value = suggestion.name;
            endAutocompleteDropdown.classList.remove('show');
        }
    }

    // Add focus event listeners to show/hide dropdowns
    startAddressInput.addEventListener('focus', function() {
        if (state.startAddressSuggestions.length > 0) {
            startAutocompleteDropdown.classList.add('show');
        }
    });

    startAddressInput.addEventListener('blur', function() {
        // Small delay to allow clicking on suggestions
        setTimeout(() => {
            startAutocompleteDropdown.classList.remove('show');
        }, 200);
    });
    
    endAddressInput.addEventListener('focus', function() {
        if (state.endAddressSuggestions.length > 0) {
            endAutocompleteDropdown.classList.add('show');
        }
    });
    
    endAddressInput.addEventListener('blur', function() {
        // Small delay to allow clicking on suggestions
        setTimeout(() => {
            endAutocompleteDropdown.classList.remove('show');
        }, 200);
    });
    
    // Add keyboard navigation for autocomplete dropdowns
    startAddressInput.addEventListener('keydown', function(e) {
        if (state.startAddressSuggestions.length > 0 && startAutocompleteDropdown.classList.contains('show')) {
            // Arrow down
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.min(state.selectedSuggestionIndex + 1, state.startAddressSuggestions.length - 1);
                updateSelectedSuggestion('start');
            }
            // Arrow up
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.max(state.selectedSuggestionIndex - 1, 0);
                updateSelectedSuggestion('start');
            }
            // Enter
            else if (e.key === 'Enter' && state.selectedSuggestionIndex >= 0) {
                e.preventDefault();
                const suggestion = state.startAddressSuggestions[state.selectedSuggestionIndex];
                selectSuggestion(suggestion, 'start');
                
                // Set coordinates and update map
                state.startCoords = [suggestion.lng, suggestion.lat];
                
                // Add custom point for the start address
                state.customPoints = state.customPoints.filter(p => p.pointType !== 'start');
                const id = 'custom-' + Date.now();
                const newPoint = {
                    id: id,
                    name: 'Start Point',
                    lng: suggestion.lng,
                    lat: suggestion.lat,
                    type: 'custom',
                    pointType: 'start'
                };
                state.customPoints.push(newPoint);
                
                updateCustomPointsOnMap();
                updateMarkers();
                
                // Zoom map to the marker location
                map.flyTo({
                    center: [suggestion.lng, suggestion.lat],
                    zoom: 15,
                    speed: 1.2
                });
                
                // Enable route finding if both points are set
                if (state.startCoords && state.endCoords) {
                    findRouteBtn.disabled = false;
                }
                
                // Hide dropdown
                startAutocompleteDropdown.classList.remove('show');
                
                // Show confirmation
                showNotification('Start point set', 'success');
            }
            // Escape
            else if (e.key === 'Escape') {
                startAutocompleteDropdown.classList.remove('show');
                state.selectedSuggestionIndex = -1;
            }
        }
    });
    
    endAddressInput.addEventListener('keydown', function(e) {
        if (state.endAddressSuggestions.length > 0 && endAutocompleteDropdown.classList.contains('show')) {
            // Arrow down
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.min(state.selectedSuggestionIndex + 1, state.endAddressSuggestions.length - 1);
                updateSelectedSuggestion('end');
            }
            // Arrow up
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.max(state.selectedSuggestionIndex - 1, 0);
                updateSelectedSuggestion('end');
            }
            // Enter
            else if (e.key === 'Enter' && state.selectedSuggestionIndex >= 0) {
                e.preventDefault();
                const suggestion = state.endAddressSuggestions[state.selectedSuggestionIndex];
                selectSuggestion(suggestion, 'end');
                
                // Set coordinates and update map
                state.endCoords = [suggestion.lng, suggestion.lat];
                
                // Add custom point for the end address
                state.customPoints = state.customPoints.filter(p => p.pointType !== 'end');
                const id = 'custom-' + Date.now();
                const newPoint = {
                    id: id,
                    name: 'End Point',
                    lng: suggestion.lng,
                    lat: suggestion.lat,
                    type: 'custom',
                    pointType: 'end'
                };
                state.customPoints.push(newPoint);
                
                updateCustomPointsOnMap();
                updateMarkers();
                
                // Zoom map to the marker location
                map.flyTo({
                    center: [suggestion.lng, suggestion.lat],
                    zoom: 15,
                    speed: 1.2
                });
                
                // Enable route finding if both points are set
                if (state.startCoords && state.endCoords) {
                    findRouteBtn.disabled = false;
                }
                
                // Hide dropdown
                endAutocompleteDropdown.classList.remove('show');
                
                // Show confirmation
                showNotification('Destination point set', 'success');
            }
            // Escape
            else if (e.key === 'Escape') {
                endAutocompleteDropdown.classList.remove('show');
                state.selectedSuggestionIndex = -1;
            }
        }
    });

    // Function to apply safety radius filter to traffic signals
    function applyTrafficSignalFilter() {
        console.time('applyTrafficSignalFilter'); // Performance measurement
        
        // Can only filter if both crime data and traffic signals are loaded
        if (!crimeMarkersLoaded || !trafficSignalsLoaded) {
            showNotification('Please load both crime data and traffic signals before applying filter', 'info');
            return;
        }
        
        // Get current crime data features (visible or not)
        let crimeFeatures = [];
        if (map.getSource('crime-data')) {
            const crimeData = map.getSource('crime-data')._data;
            if (crimeData && crimeData.features) {
                // Filter out clusters, get only individual points
                crimeFeatures = crimeData.features.filter(f => !f.properties.cluster);
                
                // If no individual points (maybe all clustered), use mock data
                if (crimeFeatures.length === 0) {
                    const mockData = generateMockCrimeData();
                    crimeFeatures = mockData.map(item => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [item.lng, item.lat]
                        },
                        properties: item
                    }));
                }
            }
        }
        
        if (crimeFeatures.length === 0) {
            showError('No crime data available for filtering');
            return;
        }
        
        // Show loading indicator for better UX during processing
        const notificationId = showNotification('Processing safety filter...', 'info', true);
        
        // Remove any existing radius visualization
        if (map.getLayer('safety-radius-circle')) {
            map.removeLayer('safety-radius-circle');
        }
        
        if (map.getSource('safety-radius')) {
            map.removeSource('safety-radius');
        }
        
        // Extract coordinates only once for better performance
        const crimePoints = crimeFeatures.map(f => ({
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0]
        }));
        
        // Convert radius from meters to approximate degrees for quick filtering
        // This is a rough approximation: 1 degree ≈ 111km at the equator
        // We'll do a precise check later, but this helps eliminate obvious non-matches quickly
        const radiusDegrees = safetyRadius / 111000;
        
        // Track signals to hide using a Set for O(1) lookups
        const idsToHide = new Set();
        
        // Increase batch size for better performance
        const batchSize = 500;
        let processedCount = 0;
        
        // Use requestAnimationFrame for smoother UI updates
        function processBatch() {
            const endIdx = Math.min(processedCount + batchSize, allTrafficSignals.length);
            const batch = allTrafficSignals.slice(processedCount, endIdx);
            
            batch.forEach(trafficSignal => {
                const tLng = trafficSignal.geometry.coordinates[0];
                const tLat = trafficSignal.geometry.coordinates[1];
                const signalId = trafficSignal.properties.id;
                
                // Skip if already marked for hiding
                if (idsToHide.has(signalId)) return;
                
                // Optimize by checking a subset of crime points first
                // This is based on the assumption that crime points are distributed
                // If there are too many crime points, sample them
                const crimesToCheck = crimePoints.length > 100 ? 
                    crimePoints.filter((_, idx) => idx % 3 === 0) : // Sample every 3rd point first
                    crimePoints;
                
                // Check against each crime point
                for (let i = 0; i < crimesToCheck.length; i++) {
                    const cPoint = crimesToCheck[i];
                    
                    // Quick bounding box check first (much faster than full distance calculation)
                    if (Math.abs(tLng - cPoint.lng) > radiusDegrees || Math.abs(tLat - cPoint.lat) > radiusDegrees) {
                        continue;
                    }
                    
                    // Now do the precise calculation using haversine formula
                    const distance = calculateDistance(tLat, tLng, cPoint.lat, cPoint.lng);
                    
                    if (distance <= safetyRadius) {
                        idsToHide.add(signalId);
                        break; // No need to check other crime points
                    }
                }
                
                // If not hidden by sampled points and we used sampling, check remaining points
                if (!idsToHide.has(signalId) && crimePoints.length > 100) {
                    // Check remaining crime points that weren't in the initial sample
                    for (let i = 0; i < crimePoints.length; i++) {
                        if (i % 3 !== 0) { // Only check points we skipped in sampling
                            const cPoint = crimePoints[i];
                            
                            // Quick bounding box check first
                            if (Math.abs(tLng - cPoint.lng) > radiusDegrees || Math.abs(tLat - cPoint.lat) > radiusDegrees) {
                                continue;
                            }
                            
                            const distance = calculateDistance(tLat, tLng, cPoint.lat, cPoint.lng);
                            
                            if (distance <= safetyRadius) {
                                idsToHide.add(signalId);
                                break;
                            }
                        }
                    }
                }
            });
            
            processedCount = endIdx;
            
            if (processedCount < allTrafficSignals.length) {
                // Use requestAnimationFrame instead of setTimeout for smoother performance
                requestAnimationFrame(processBatch);
            } else {
                // All batches processed, update the map
                finishFiltering();
            }
        }
        
        function finishFiltering() {
            // Filter traffic signals
            filteredTrafficSignals = allTrafficSignals.filter(f => !idsToHide.has(f.properties.id));
            
            // Update the traffic signals source with the filtered features
            const trafficSignalsSource = map.getSource('traffic-signals');
            if (trafficSignalsSource) {
                trafficSignalsSource.setData({
                    type: 'FeatureCollection',
                    features: filteredTrafficSignals
                });
            }
            
            // Set the filter active state
            safetyFilterActive = true;
            
            // Add "filter-active" class to the button to show it's applied
            resetSafetyFilterBtn.classList.add('filter-active');
            
            // Show notification
            const hiddenCount = allTrafficSignals.length - filteredTrafficSignals.length;
            showNotification(`Safety filter applied: Removed ${hiddenCount} traffic signals within ${safetyRadius}m of crime locations`, 'success');
            
            console.timeEnd('applyTrafficSignalFilter'); // Performance measurement
            clearNotification(notificationId);
        }
        
        // Helper function for distance calculation
        function calculateDistance(lat1, lon1, lat2, lon2) {
            // Haversine formula for distance between two points on Earth
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = 
                Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c; // Distance in meters
        }
        
        // Start processing
        processBatch();
    }
    
    // Function to reset traffic signal filter
    function resetTrafficSignalFilter() {
        // Update the traffic signals source with all features
        const trafficSignalsSource = map.getSource('traffic-signals');
        if (trafficSignalsSource) {
            trafficSignalsSource.setData({
                type: 'FeatureCollection',
                features: allTrafficSignals
            });
        }
        
        // Remove any radius visualization
        if (map.getLayer('safety-radius-circle')) {
            map.removeLayer('safety-radius-circle');
        }
        
        if (map.getSource('safety-radius')) {
            map.removeSource('safety-radius');
        }
        
        // Reset the filter active state
        safetyFilterActive = false;
        
        // Remove "filter-active" class
        resetSafetyFilterBtn.classList.remove('filter-active');
        
        // No need to update the button text as it always says "Reset"
        
        showNotification('Safety filter has been reset', 'info');
    }
    
    // No need for this duplicate event listener since we already set it up above

    // Add click handler for traffic signals
    map.on('click', 'traffic-signals', function(e) {
        // If we're in drawing mode or marker placement mode, don't intercept the click
        if (state.isDrawingMode || markerPlacementMode || e.originalEvent._skipClickHandler) {
            // Let the main map click handler handle this
            return;
        }
        
        // Prevent the click from reaching the map
        e.originalEvent.stopPropagation();

        const coordinates = e.features[0].geometry.coordinates.slice();
        const featureId = e.features[0].properties.id;
        
        // Check if traffic signal is already in waypoints
        const existingWaypointIndex = state.waypoints.findIndex(wp => wp.id === featureId);
        
        if (existingWaypointIndex !== -1) {
            // Remove from waypoints if already added
            state.waypoints.splice(existingWaypointIndex, 1);
            showNotification('Traffic signal removed from route', 'info');
        } else {
            // Add to waypoints
            state.waypoints.push({
                id: featureId,
                coordinates: coordinates,
                type: 'traffic-signal'
            });
            showNotification('Traffic signal added to route', 'success');
        }
        
        // Update waypoints visualization
        updateWaypointsOnMap();
        
        // Create a custom "Own Route" option when adding waypoints
        if (state.waypoints.length > 0) {
            // Add custom route option to route alternatives
            if (state.startCoords && state.endCoords) {
                // Create a modified version of adjustRoute for traffic signals
                const getRouteWithWaypoints = async () => {
                    showLoading(true);
                    
                    try {
                        // Always use walking mode
                        const travelMode = 'walking';
                        
                        // Get waypoints from state.waypoints
                        const waypoints = state.waypoints.map(wp => wp.coordinates);
                        
                        const response = await fetch('/adjust_route', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                start: state.startCoords,
                                end: state.endCoords,
                                waypoints: waypoints,
                                mode: travelMode
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            // Save adjusted route
                            state.currentRoute = data.path;
                            state.currentRouteDistance = data.distance;
                            state.currentRouteDuration = data.duration;
                            
                            // Update route on map
                            updateRouteOnMap(data.path);
                            
                            // Create or update the Own Route option
                            let ownRouteIndex = -1;
                            for (let i = 0; i < state.routeAlternatives.length; i++) {
                                if (state.routeAlternatives[i].name === "Own Route") {
                                    ownRouteIndex = i;
                                    break;
                                }
                            }
                            
                            const ownRoute = {
                                path: data.path,
                                distance: data.distance,
                                duration: data.duration,
                                name: "Own Route",
                                isReal: true,
                                source: "custom",
                                waypoints: state.waypoints.map(wp => wp.coordinates)
                            };
                            
                            if (ownRouteIndex !== -1) {
                                // Update existing own route
                                state.routeAlternatives[ownRouteIndex] = ownRoute;
                            } else {
                                // Add new own route at the beginning
                                state.routeAlternatives.unshift(ownRoute);
                            }
                            
                            // Update the route options panel
                            updateRouteOptionsPanel(state.routeAlternatives);
                            
                            // Calculate safety score for the custom route
                            calculateSafetyScore(data.path).then(safetyScore => {
                                ownRoute.safetyScore = safetyScore;
                                
                                // Find the route again to update it
                                for (let i = 0; i < state.routeAlternatives.length; i++) {
                                    if (state.routeAlternatives[i].name === "Own Route") {
                                        state.routeAlternatives[i].safetyScore = safetyScore;
                                        break;
                                    }
                                }
                                
                                updateRouteOptionsPanel(state.routeAlternatives);
                            });
                            
                            // Display route information
                            displayRouteInfo(data.distance, data.duration);
                            
                            // Enable reset button
                            resetRouteBtn.disabled = false;
                            
                            // Preload street lamp data for the route
                            preloadStreetLampData(data.path);
                            
                            return data.path;
                        } else {
                            showError('Failed to adjust route');
                            return null;
                        }
                    } catch (error) {
                        showError(`Network error: ${error.message}`);
                        return null;
                    } finally {
                        showLoading(false);
                    }
                };
                
                // Call our custom route function
                getRouteWithWaypoints();
            } else {
                showNotification('Set start and end points to create a route', 'info');
            }
        } else {
            // If no waypoints left, recalculate the original route
            findRoute();
        }
    });

    // Add click handler for crime markers
    map.on('click', 'crime-markers', function(e) {
        // If we're in drawing mode or marker placement mode, don't intercept the click
        if (state.isDrawingMode || markerPlacementMode || e.originalEvent._skipClickHandler) {
            // Let the main map click handler handle this
            return;
        }
        
        // Prevent the click from reaching the map
        e.originalEvent.stopPropagation();
        
        // Handle click on crime marker - just show info by default
        // You can add functionality to add as waypoints if desired
    });

    // Allow clicks to pass through to the map when in drawing mode
    map.on('mousedown', 'traffic-signals', function(e) {
        if (state.isDrawingMode || markerPlacementMode) {
            // Override stopPropagation to do nothing
            e.originalEvent.stopPropagation = function() {};
            // Explicitly set a flag to skip the click handler
            e.originalEvent._skipClickHandler = true;
            return false;
        }
    });
    
    map.on('mousedown', 'crime-markers', function(e) {
        if (state.isDrawingMode || markerPlacementMode) {
            // Override stopPropagation to do nothing
            e.originalEvent.stopPropagation = function() {};
            // Explicitly set a flag to skip the click handler
            e.originalEvent._skipClickHandler = true;
            return false;
        }
    });
    
    // Add click handler for street lamps
    map.on('click', 'street-lamps', function(e) {
        // If we're in drawing mode or marker placement mode, don't intercept the click
        if (state.isDrawingMode || markerPlacementMode || e.originalEvent._skipClickHandler) {
            // Let the main map click handler handle this
            return;
        }
        
        // Prevent the click from reaching the map
        e.originalEvent.stopPropagation();

        const coordinates = e.features[0].geometry.coordinates.slice();
        const featureId = e.features[0].properties.id;
        
        // Check if street lamp is already in waypoints
        const existingWaypointIndex = state.waypoints.findIndex(wp => 
            wp.id === featureId && wp.type === 'street-lamp');
        
        if (existingWaypointIndex !== -1) {
            // Remove from waypoints if already added
            state.waypoints.splice(existingWaypointIndex, 1);
            showNotification('Street lamp removed from route', 'info');
        } else {
            // Add to waypoints
            state.waypoints.push({
                id: featureId,
                coordinates: coordinates,
                type: 'street-lamp'
            });
            showNotification('Street lamp added to route', 'success');
        }
        
        // Update waypoints visualization
        updateWaypointsOnMap();
        
        // Create a custom "Own Route" option when adding waypoints
        if (state.waypoints.length > 0) {
            // Add custom route option to route alternatives
            if (state.startCoords && state.endCoords) {
                // Create a modified version of adjustRoute for street lamps
                const getRouteWithWaypoints = async () => {
                    showLoading(true);
                    
                    try {
                        // Always use walking mode
                        const travelMode = 'walking';
                        
                        // Get waypoints from state.waypoints
                        const waypoints = state.waypoints.map(wp => wp.coordinates);
                        
                        const response = await fetch('/adjust_route', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                start: state.startCoords,
                                end: state.endCoords,
                                waypoints: waypoints,
                                mode: travelMode
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            // Save adjusted route
                            state.currentRoute = data.path;
                            state.currentRouteDistance = data.distance;
                            state.currentRouteDuration = data.duration;
                            
                            // Update route on map
                            updateRouteOnMap(data.path);
                            
                            // Create or update the Own Route option
                            let ownRouteIndex = -1;
                            for (let i = 0; i < state.routeAlternatives.length; i++) {
                                if (state.routeAlternatives[i].name === "Own Route") {
                                    ownRouteIndex = i;
                                    break;
                                }
                            }
                            
                            const ownRoute = {
                                path: data.path,
                                distance: data.distance,
                                duration: data.duration,
                                name: "Own Route",
                                isReal: true,
                                source: "custom",
                                waypoints: state.waypoints.map(wp => wp.coordinates)
                            };
                            
                            if (ownRouteIndex !== -1) {
                                // Update existing own route
                                state.routeAlternatives[ownRouteIndex] = ownRoute;
                            } else {
                                // Add new own route at the beginning
                                state.routeAlternatives.unshift(ownRoute);
                            }
                            
                            // Update the route options panel
                            updateRouteOptionsPanel(state.routeAlternatives);
                            
                            // Calculate safety score for the custom route
                            calculateSafetyScore(data.path).then(safetyScore => {
                                ownRoute.safetyScore = safetyScore;
                                
                                // Find the route again to update it
                                for (let i = 0; i < state.routeAlternatives.length; i++) {
                                    if (state.routeAlternatives[i].name === "Own Route") {
                                        state.routeAlternatives[i].safetyScore = safetyScore;
                                        break;
                                    }
                                }
                                
                                updateRouteOptionsPanel(state.routeAlternatives);
                            });
                            
                            // Display route information
                            displayRouteInfo(data.distance, data.duration);
                            
                            // Enable reset button
                            resetRouteBtn.disabled = false;
                            
                            // Preload street lamp data for the route
                            preloadStreetLampData(data.path);
                            
                            return data.path;
                        } else {
                            showError('Failed to adjust route');
                            return null;
                        }
                    } catch (error) {
                        showError(`Network error: ${error.message}`);
                        return null;
                    } finally {
                        showLoading(false);
                    }
                };
                
                // Call our custom route function
                getRouteWithWaypoints();
            } else {
                showNotification('Set start and end points to create a route', 'info');
            }
        } else {
            // If no waypoints left, recalculate the original route
            findRoute();
        }
    });
    
    // Add mousedown handler for street lamps to allow pass-through click in drawing mode
    map.on('mousedown', 'street-lamps', function(e) {
        if (state.isDrawingMode || markerPlacementMode) {
            // Override stopPropagation to do nothing
            e.originalEvent.stopPropagation = function() {};
            // Explicitly set a flag to skip the click handler
            e.originalEvent._skipClickHandler = true;
            return false;
        }
    });
    
    // Add hover effect for street lamps
    map.on('mouseenter', 'street-lamps', function(e) {
        map.getCanvas().style.cursor = 'pointer';
        
        // Create popup for street lamps
        const coordinates = e.features[0].geometry.coordinates.slice();
        
        new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 10
        })
        .setLngLat(coordinates)
        .setHTML('<strong>Street Lamp</strong><br><small>Click to add to route</small>')
        .addTo(map);
    });
    
    map.on('mouseleave', 'street-lamps', function() {
        map.getCanvas().style.cursor = '';
        
        // Remove popup
        const popups = document.getElementsByClassName('mapboxgl-popup');
        if (popups.length) {
            popups[0].remove();
        }
    });

    // Function to update waypoints visualization on the map
    function updateWaypointsOnMap() {
        if (!map.getSource('waypoints')) {
            map.addSource('waypoints', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
            
            map.addLayer({
                id: 'waypoints',
                type: 'circle',
                source: 'waypoints',
                paint: {
                    'circle-radius': 10,
                    'circle-color': '#4ECDC4',
                    'circle-opacity': 0.8,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#FFFFFF'
                }
            });
        }
        
        // Update waypoints source
        const features = state.waypoints.map(waypoint => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: waypoint.coordinates
            },
            properties: {
                id: waypoint.id,
                type: waypoint.type
            }
        }));
        
        map.getSource('waypoints').setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    // Function to add street lamp layers to the map
    function addStreetLampLayers() {
        // Add source for street lamps if it doesn't exist
        if (!map.getSource('street-lamps')) {
            map.addSource('street-lamps', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }
        
        // Add layer for street lamps if it doesn't exist
        if (!map.getLayer('street-lamps')) {
            map.addLayer({
                id: 'street-lamps',
                type: 'circle',
                source: 'street-lamps',
                paint: {
                    'circle-color': '#FF9800', // Orange color
                    'circle-radius': 4,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.9)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            });
            
            // Add halo layer for street lamps for better visibility
            map.addLayer({
                id: 'street-lamps-halo',
                type: 'circle',
                source: 'street-lamps',
                paint: {
                    'circle-color': 'rgba(255, 152, 0, 0.3)', // Translucent orange
                    'circle-radius': 8,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.5)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            }, 'street-lamps'); // Place this layer below the main street lamps layer
        }
    }

    // Update existing fetchStreetLamps function to add lamps to the map
    async function fetchStreetLamps(bbox) {
        if (!bbox) {
            // Use current map bounds if no bbox is provided
            const bounds = map.getBounds();
            bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        }
        
        // Construct Overpass API query to get street lamps
        const query = `
            [out:json];
            (
              node["highway"="street_lamp"](${bbox});
            );
            out body;
        `;
        
        // Show notification
        showNotification('Fetching street lamp data...', 'info');
        
        try {
            // Fetch street lamps data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch street lamp data');
            }
            
            const data = await response.json();
            
            // Convert OSM data to GeoJSON features
            const features = data.elements.map(element => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [element.lon, element.lat]
                },
                properties: {
                    id: element.id,
                    tags: element.tags
                }
            }));
            
            // Store street lamps data globally
            window.state.streetLamps = features;
            
            // Make sure the layer exists
            addStreetLampLayers();
            
            // Update the street lamps source with the features
            const streetLampsSource = map.getSource('street-lamps');
            if (streetLampsSource) {
                streetLampsSource.setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
            
            // Show notification with count
            showNotification(`Loaded ${features.length} street lamps in the area`, 'info');
            
            return features;
        } catch (error) {
            console.error('Error fetching street lamps:', error);
            showNotification('Failed to fetch street lamp data', 'error');
            return [];
        }
    }

    // Function to toggle street lamps visibility
    function toggleStreetLamps() {
        // Get the button element
        const streetLampsBtn = document.getElementById('toggle-street-lamps');
        
        // Check if the layer exists
        if (!map.getLayer('street-lamps')) {
            addStreetLampLayers();
        }
        
        // Track street lamps visibility state
        let streetLampsVisible = false;
        
        // Get current visibility
        const visibility = map.getLayoutProperty('street-lamps', 'visibility');
        
        // Toggle visibility
        if (visibility === 'visible') {
            map.setLayoutProperty('street-lamps', 'visibility', 'none');
            map.setLayoutProperty('street-lamps-halo', 'visibility', 'none');
            streetLampsVisible = false;
            
            // Update button appearance
            if (streetLampsBtn) {
                streetLampsBtn.classList.remove('active');
            }
        } else {
            // Check if we're currently in a filtered state (after safety analysis)
            const isFilteredState = window._filteredStreetLamps && 
                                   window._filteredStreetLamps.features &&
                                   window._filteredStreetLamps.features.length > 0;
            
            // If we're in a filtered state after safety analysis, preserve the filtered lamps
            if (isFilteredState) {
                console.log(`Preserving filtered street lamps state with ${window._filteredStreetLamps.features.length} lamps`);
                
                // Update the source with the filtered lamps data
                const streetLampsSource = map.getSource('street-lamps');
                if (streetLampsSource) {
                    streetLampsSource.setData(window._filteredStreetLamps);
                }
                
                map.setLayoutProperty('street-lamps', 'visibility', 'visible');
                map.setLayoutProperty('street-lamps-halo', 'visibility', 'visible');
                streetLampsVisible = true;
        } else {
            // If we don't have street lamps data yet, fetch it
            if (!window.state.streetLamps || !window.state.streetLamps.length) {
                    // Show loading notification
                    showNotification('Loading street lamp data...', 'info');
                    
                    // Fetch in the current map bounds
                    fetchStreetLamps().then(lamps => {
                        if (lamps.length > 0) {
                            showNotification(`Found ${lamps.length} street lamps in the area`, 'success');
                        } else {
                            showNotification('No street lamps found in this area', 'info');
                        }
                    });
                } else {
                    // Show all lamps if we're not in a filtered state
                    const streetLampsSource = map.getSource('street-lamps');
                    if (streetLampsSource) {
                        streetLampsSource.setData({
                            type: 'FeatureCollection',
                            features: window.state.streetLamps
                        });
                        console.log(`Showing all ${window.state.streetLamps.length} street lamps`);
                    }
            }
            
            map.setLayoutProperty('street-lamps', 'visibility', 'visible');
                map.setLayoutProperty('street-lamps-halo', 'visibility', 'visible');
                streetLampsVisible = true;
            }
            
            // Update button appearance
            if (streetLampsBtn) {
                streetLampsBtn.classList.add('active');
            }
        }
        
        return streetLampsVisible;
    }

    // Make sure to call addStreetLampLayers when the map loads
    map.on('load', function() {
        // ... existing map load code ...
        
        // Add street lamp layers
        addStreetLampLayers();
        
        // Add hospital layers
        addHospitalLayers();
        
        // ... existing map load code ...
    });

    // Function to add hospital layers to the map
    function addHospitalLayers() {
        // Add source for hospitals if it doesn't exist
        if (!map.getSource('hospitals')) {
            map.addSource('hospitals', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }
        
        // Add layer for hospitals if it doesn't exist
        if (!map.getLayer('hospitals')) {
            map.addLayer({
                id: 'hospitals',
                type: 'circle',
                source: 'hospitals',
                paint: {
                    'circle-color': '#F48FB1', // Light pink color
                    'circle-radius': 5,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.9)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            });
            
            // Add halo layer for hospitals for better visibility
            map.addLayer({
                id: 'hospitals-halo',
                type: 'circle',
                source: 'hospitals',
                paint: {
                    'circle-color': 'rgba(244, 143, 177, 0.3)', // Translucent light pink
                    'circle-radius': 10,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.5)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            }, 'hospitals'); // Place this layer below the main hospitals layer
        }
        
        // Change cursor to pointer when hovering hospitals
        map.on('mouseenter', 'hospitals', function() {
            map.getCanvas().style.cursor = 'pointer';
        });
        
        // Change cursor back when leaving hospitals
        map.on('mouseleave', 'hospitals', function() {
            map.getCanvas().style.cursor = '';
        });
    }

    // Function to fetch hospital data from OpenStreetMap
    async function fetchHospitals(bbox) {
        if (!bbox) {
            // Use current map bounds if no bbox is provided
            const bounds = map.getBounds();
            bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        }
        
        // Construct Overpass API query to get hospitals
        const query = `
            [out:json];
            (
              node["amenity"="hospital"](${bbox});
              way["amenity"="hospital"](${bbox});
              relation["amenity"="hospital"](${bbox});
            );
            out center;
        `;
        
        // Show notification
        showNotification('Fetching hospital data...', 'info');
        
        try {
            // Fetch hospital data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch hospital data');
            }
            
            const data = await response.json();
            
            // Convert OSM data to GeoJSON features
            const features = data.elements.map(element => {
                // Handle different element types (node, way, relation)
                let coordinates;
                if (element.type === 'node') {
                    coordinates = [element.lon, element.lat];
                } else {
                    // For ways and relations, use the center point
                    coordinates = [element.center.lon, element.center.lat];
                }
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coordinates
                    },
                    properties: {
                        id: element.id,
                        name: element.tags && element.tags.name ? element.tags.name : 'Hospital',
                        tags: JSON.stringify(element.tags || {})
                    }
                };
            });
            
            // Store hospitals data globally
            window.state.hospitals = features;
            
            // Make sure the layer exists
            addHospitalLayers();
            
            // Update the hospitals source with the features
            const hospitalsSource = map.getSource('hospitals');
            if (hospitalsSource) {
                hospitalsSource.setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
            
            // Show notification with count
            showNotification(`Loaded ${features.length} hospitals in the area`, 'info');
            
            return features;
        } catch (error) {
            console.error('Error fetching hospitals:', error);
            showNotification('Failed to fetch hospital data', 'error');
            return [];
        }
    }

    // Function to toggle hospitals visibility
    function toggleHospitals() {
        // Get the button element
        const hospitalsBtn = document.getElementById('toggle-hospitals');
        
        // Check if the layer exists
        if (!map.getLayer('hospitals')) {
            addHospitalLayers();
        }
        
        // Track hospitals visibility state
        let hospitalsVisible = false;
        
        // Get current visibility
        const visibility = map.getLayoutProperty('hospitals', 'visibility');
        
        // Toggle visibility
        if (visibility === 'visible') {
            map.setLayoutProperty('hospitals', 'visibility', 'none');
            map.setLayoutProperty('hospitals-halo', 'visibility', 'none');
            hospitalsVisible = false;
            
            // Update button appearance
            if (hospitalsBtn) {
                hospitalsBtn.classList.remove('active');
            }
        } else {
            // Check if we're currently in a filtered state (after hospital search)
            const isFilteredState = window._filteredHospitals && 
                                  window._filteredHospitals.features &&
                                  window._filteredHospitals.features.length > 0;
            
            // If we're in a filtered state, use the filtered hospitals
            if (isFilteredState) {
                console.log(`Preserving filtered hospitals state with ${window._filteredHospitals.features.length} hospitals`);
                
                // Update the source with the filtered hospitals data
                const hospitalsSource = map.getSource('hospitals');
                if (hospitalsSource) {
                    hospitalsSource.setData(window._filteredHospitals);
                }
                
                map.setLayoutProperty('hospitals', 'visibility', 'visible');
                map.setLayoutProperty('hospitals-halo', 'visibility', 'visible');
                hospitalsVisible = true;
            }
            // If we don't have hospitals data yet, fetch it
            else if (!window.state.hospitals || !window.state.hospitals.length) {
                // Show loading notification
                showNotification('Loading hospital data...', 'info');
                
                // Fetch in the current map bounds
                fetchHospitals().then(hospitals => {
                    if (hospitals.length > 0) {
                        showNotification(`Found ${hospitals.length} hospitals in the area`, 'success');
                    } else {
                        showNotification('No hospitals found in this area', 'info');
                    }
                });
            } else {
                // Show all hospitals if we're not in a filtered state
                const hospitalsSource = map.getSource('hospitals');
                if (hospitalsSource) {
                    hospitalsSource.setData({
                        type: 'FeatureCollection',
                        features: window.state.hospitals
                    });
                    console.log(`Showing all ${window.state.hospitals.length} hospitals`);
                }
            }
            
            map.setLayoutProperty('hospitals', 'visibility', 'visible');
            map.setLayoutProperty('hospitals-halo', 'visibility', 'visible');
            hospitalsVisible = true;
            
            // Update button appearance
            if (hospitalsBtn) {
                hospitalsBtn.classList.add('active');
            }
        }
        
        // Set the global visibility state
        window.hospitalsVisible = hospitalsVisible;
        
        return hospitalsVisible;
    }

    // Function to count street lamps along a route
    function countStreetLampsAlongRoute(route, streetLamps, bufferDistance = 25) {
        if (!route || !route.length || !streetLamps || !streetLamps.length) {
            console.log("Missing route or streetlamps data", {
                routeExists: !!route,
                routeLength: route?.length || 0,
                streetLampsExists: !!streetLamps,
                streetLampsLength: streetLamps?.length || 0
            });
            return 0;
        }

        // Create a buffer around the route (bufferDistance in meters)
        // We'll check if street lamps are within this buffer
        const nearbyLamps = [];
        
        // Log input data for debugging
        console.log(`Analyzing route with ${route.length} coordinates and ${streetLamps.length} street lamps`);
        console.log("First route point:", route[0]);
        console.log("First lamp:", streetLamps[0]);
        
        // For each street lamp, check if it's close to any point on the route
        for (const lamp of streetLamps) {
            if (!lamp.geometry || !lamp.geometry.coordinates) {
                console.warn("Invalid lamp data format:", lamp);
                continue;
            }
            
            const lampCoords = lamp.geometry.coordinates;
            // Create a Leaflet latLng object from the lamp coordinates
            // NOTE: Leaflet uses [lat, lng] while GeoJSON uses [lng, lat]
            const lampLatLng = L.latLng(lampCoords[1], lampCoords[0]);
            
            // Check distance to route segments
            for (let i = 0; i < route.length - 1; i++) {
                // Handle different possible route coordinate formats
                let segmentStart, segmentEnd;
                
                if (Array.isArray(route[i])) {
                    // Format [lng, lat] from route data
                    segmentStart = L.latLng(route[i][1], route[i][0]);
                    segmentEnd = L.latLng(route[i+1][1], route[i+1][0]);
                } else if (route[i].lat !== undefined && route[i].lng !== undefined) {
                    // Format {lat, lng} from safety.js
                    segmentStart = L.latLng(route[i].lat, route[i].lng);
                    segmentEnd = L.latLng(route[i+1].lat, route[i+1].lng);
                } else {
                    console.warn("Unrecognized route coordinate format at index", i, route[i]);
                    continue;
                }
                
                try {
                    // Calculate closest point on segment to lamp
                    const closestPoint = L.GeometryUtil.closestPointOnSegment(
                        map, lampLatLng, segmentStart, segmentEnd
                    );
                    
                    // Calculate distance from lamp to closest point on segment
                    const distance = lampLatLng.distanceTo(closestPoint);
                    
                    // If distance is within buffer, add lamp to nearby lamps
                    if (distance <= bufferDistance) {
                        nearbyLamps.push(lamp);
                        break; // No need to check other segments for this lamp
                    }
                } catch (error) {
                    console.error("Error calculating distance to segment:", error);
                }
            }
        }
        
        console.log(`Found ${nearbyLamps.length} lamps within ${bufferDistance}m of the route`);
        return nearbyLamps.length;
    }

    // Function to analyze route safety based on street lamps
    async function analyzeRouteLighting(route) {
        if (!route || !route.length) {
            return {
                count: 0,
                density: 0,
                coverage: 0,
                isSafe: false
            };
        }
        
        // If we don't have street lamps data yet, fetch it
        if (!window.state.streetLamps || !window.state.streetLamps.length) {
            // Calculate bbox that encompasses the route with some padding
            const bounds = new mapboxgl.LngLatBounds();
            route.forEach(point => bounds.extend(point));
            
            // Add padding to the bounds
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const padding = 0.01; // about 1km
            
            const bbox = `${sw.lat - padding},${sw.lng - padding},${ne.lat + padding},${ne.lng + padding}`;
            
            // Fetch street lamps in this area
            await fetchStreetLamps(bbox);
        }
        
        // Count street lamps along the route
        const lampsCount = countStreetLampsAlongRoute(route, window.state.streetLamps);
        
        // Calculate route length in meters
        let routeLength = 0;
        for (let i = 0; i < route.length - 1; i++) {
            const start = L.latLng(route[i][1], route[i][0]);
            const end = L.latLng(route[i+1][1], route[i+1][0]);
            routeLength += start.distanceTo(end);
        }
        
        // Calculate average number of street lamps per 100m
        const lampDensity = (routeLength > 0) ? (lampsCount / routeLength) * 100 : 0;
        
        // Calculate coverage (percentage of route within 25m of a street lamp)
        // This is a simplification; for a proper implementation, we'd need to
        // calculate the exact coverage
        const coverage = Math.min(lampDensity * 10, 100); // Simple estimate
        
        // Determine if route is safely lit (threshold can be adjusted)
        const isSafe = lampDensity >= 0.5; // At least 1 lamp per 200m
        
        return {
            count: lampsCount,
            density: lampDensity.toFixed(2),
            coverage: coverage.toFixed(1),
            routeLength: (routeLength / 1000).toFixed(2), // km
            isSafe: isSafe
        };
    }
    
    // Expose global state and functions for other scripts
    window.mapState = {
        hasRoute: false,
        routeLoaded: false,
        currentRouteLength: 0,
        currentRouteDistance: 0
    };
    
    window.getCurrentRoute = function() {
        console.log("getCurrentRoute called, returning:", state.currentRoute);
        return state.currentRoute;
    };
    
    // Expose functions to window for access from chat.js
    window.analyzeRouteLighting = analyzeRouteLighting;
    window.fetchStreetLamps = fetchStreetLamps;
    window.toggleStreetLamps = toggleStreetLamps;
    window.countStreetLampsAlongRoute = countStreetLampsAlongRoute;
    window.fetchHospitals = fetchHospitals;
    window.toggleHospitals = toggleHospitals;
    window.findHospitalsNearRoute = findHospitalsNearRoute;
    window.resetHospitalFilter = resetHospitalFilter;

    // Function to count crime incidents along a route
    function countCrimeIncidentsAlongRoute(route, buffer = 16) { // Using 16 meters buffer to match the AI safety analysis
        if (!route || !route.length) {
            console.log("Missing route data for crime analysis");
            return { count: 0, types: {}, incidents: [], hourlyDistribution: Array(24).fill(0) };
        }

        // Get crime data features from the map source
        let crimeFeatures = [];
        
        // First check if we have filtered crime data from route analysis
        if (window._filteredCrimeData && window._filteredCrimeData.features) {
            console.log("Using pre-filtered crime data for time analysis");
            crimeFeatures = window._filteredCrimeData.features.filter(f => !f.properties.cluster);
            console.log(`Found ${crimeFeatures.length} pre-filtered crime features`);
            
            // Log properties of first few crime features to help debug time extraction
            if (crimeFeatures.length > 0) {
                console.log("Sample crime feature properties (first 3):");
                for (let i = 0; i < Math.min(3, crimeFeatures.length); i++) {
                    console.log(`Crime #${i+1}:`, crimeFeatures[i].properties);
                }
            }
        }
        // Fallback to map source if no filtered data available
        else if (map.getSource('crime-data')) {
            const crimeData = map.getSource('crime-data')._data;
            console.log("Crime data found in map source:", crimeData ? "Yes" : "No");
            if (crimeData && crimeData.features) {
                // Filter out clusters, get only individual points
                crimeFeatures = crimeData.features.filter(f => !f.properties.cluster);
                console.log(`Found ${crimeFeatures.length} individual crime features (excluding clusters)`);
                
                // Check if we have original data before clustering (more accurate)
                if (window._rawCrimeFeatures && window._rawCrimeFeatures.length > 0) {
                    console.log(`Found ${window._rawCrimeFeatures.length} raw crime features - using these instead of filtered clusters`);
                    crimeFeatures = window._rawCrimeFeatures;
                }
            }
        } else {
            console.log("No crime-data source found in map");
        }
        
        // If no crime data is available or loaded, return empty results
        if (!crimeFeatures || crimeFeatures.length === 0) {
            console.log("No crime data available");
            return { count: 0, types: {}, incidents: [], hourlyDistribution: Array(24).fill(0) };
        }
        
        console.log(`Analyzing route for crime incidents with ${buffer}m buffer`);
        
        const nearbyCrimes = [];
        const crimeTypes = {};
        const detailedIncidents = [];
        
        // Current date for calculating how recent crimes are
        const currentDate = new Date();
        
        // Track hourly distribution
        const hourlyDistribution = Array(24).fill(0);
        
        // Initialize time categories
        const timeCategories = {
            'Morning (6am-12pm)': 0,
            'Afternoon (12pm-6pm)': 0,
            'Evening (6pm-10pm)': 0,
            'Night (10pm-6am)': 0,
            'Unknown': 0
        };
        
        // For each crime incident, check if it's close to the route
        for (const crime of crimeFeatures) {
            if (!crime.geometry || !crime.geometry.coordinates) {
                console.warn("Invalid crime data format:", crime);
                continue;
            }
            
            const crimeCoords = crime.geometry.coordinates;
            // Create a Leaflet latLng object from the crime coordinates
            const crimeLatLng = L.latLng(crimeCoords[1], crimeCoords[0]);
            
            // Check distance to route segments
            let minimumDistance = Infinity;
            let closestSegmentIndex = -1;
            
            for (let i = 0; i < route.length - 1; i++) {
                // Handle different possible route coordinate formats
                let segmentStart, segmentEnd;
                
                if (Array.isArray(route[i])) {
                    // Format [lng, lat] from route data
                    segmentStart = L.latLng(route[i][1], route[i][0]);
                    segmentEnd = L.latLng(route[i+1][1], route[i+1][0]);
                } else if (route[i].lat !== undefined && route[i].lng !== undefined) {
                    // Format {lat, lng} from safety.js
                    segmentStart = L.latLng(route[i].lat, route[i].lng);
                    segmentEnd = L.latLng(route[i+1].lat, route[i+1].lng);
                } else {
                    continue;
                }
                
                try {
                    // Enhanced distance calculation for more accuracy
                    let distance;
                    
                    // Try using Leaflet's GeometryUtil if available
                    if (typeof L.GeometryUtil !== 'undefined' && L.GeometryUtil.closestPointOnSegment) {
                        const closestPoint = L.GeometryUtil.closestPointOnSegment(
                            map, crimeLatLng, segmentStart, segmentEnd
                        );
                        distance = crimeLatLng.distanceTo(closestPoint);
                    } else {
                        // Improved fallback distance calculation
                        // This calculates perpendicular distance to the line segment, not just endpoints
                        const distToStart = crimeLatLng.distanceTo(segmentStart);
                        const distToEnd = crimeLatLng.distanceTo(segmentEnd);
                        const segmentLength = segmentStart.distanceTo(segmentEnd);
                        
                        // Calculate perpendicular distance using Heron's formula if point is between endpoints
                        const dotProduct = (crimeLatLng.lat - segmentStart.lat) * (segmentEnd.lat - segmentStart.lat) +
                                          (crimeLatLng.lng - segmentStart.lng) * (segmentEnd.lng - segmentStart.lng);
                        const projection = dotProduct / (segmentLength * segmentLength);
                        
                        if (projection < 0) {
                            // Point is beyond the start point
                            distance = distToStart;
                        } else if (projection > 1) {
                            // Point is beyond the end point
                            distance = distToEnd;
                        } else {
                            // Calculate perpendicular distance
                            const a = distToStart;
                            const b = distToEnd;
                            const c = segmentLength;
                            const s = (a + b + c) / 2;
                            // Area of the triangle using Heron's formula
                            const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
                            // Height = 2 * area / base
                            distance = 2 * area / c;
                        }
                        
                        console.warn("Using improved fallback distance calculation");
                    }
                    
                    // Track minimum distance to the route
                    if (distance < minimumDistance) {
                        minimumDistance = distance;
                        closestSegmentIndex = i;
                    }
                    
                    // If distance is within buffer, add crime to nearby crimes
                    if (distance <= buffer) {
                        nearbyCrimes.push(crime);
                        
                        // Extract crime details
                        const properties = crime.properties || {};
                        
                        // Determine crime type with fallbacks
                        const crimeType = properties.event_type || 
                                         properties.type || 
                                         properties.crime_type ||
                                         'Unknown';
                        
                        // Track crime types
                        if (!crimeTypes[crimeType]) {
                            crimeTypes[crimeType] = 1;
                        } else {
                            crimeTypes[crimeType]++;
                        }
                        
                        // Extract date and time information
                        let incidentDate = null;
                        let daysAgo = null;
                        let timeOfDay = null;
                        let hour = -1;
                        
                        // Debug: log properties to see what's available
                        console.log("Crime properties:", properties);
                        
                        // Parse date from various possible formats
                        if (properties.date) {
                            try {
                                incidentDate = new Date(properties.date);
                                if (!isNaN(incidentDate.getTime())) {
                                    // Calculate days ago
                                    const timeDiff = currentDate.getTime() - incidentDate.getTime();
                                    daysAgo = Math.floor(timeDiff / (1000 * 3600 * 24));
                                    
                                    // Try to get hour from the date object if time is included
                                    const extractedHour = incidentDate.getHours();
                                    if (!isNaN(extractedHour)) {
                                        hour = extractedHour;
                                        console.log(`Extracted hour from date object: ${hour}`);
                                    }
                                }
                            } catch (e) {
                                console.warn("Error parsing date:", properties.date);
                            }
                        }
                        
                        // Try multiple methods to extract the hour information
                        // Method 1: Parse time information from various property formats
                        if (hour === -1 && properties.time) {
                            const timeStr = properties.time;
                            
                            // Try to extract hour from HH:MM format
                            if (timeStr.includes(':')) {
                                const timeParts = timeStr.split(':');
                                hour = parseInt(timeParts[0], 10);
                            } 
                            // Try to extract from "10pm", "3am" format
                            else if (/\d+(am|pm)/i.test(timeStr)) {
                                const match = timeStr.match(/(\d+)\s*(am|pm)/i);
                                if (match) {
                                    let h = parseInt(match[1], 10);
                                    const period = match[2].toLowerCase();
                                    
                                    // Convert to 24-hour
                                    if (period === 'pm' && h < 12) h += 12;
                                    if (period === 'am' && h === 12) h = 0;
                                    
                                    hour = h;
                                }
                            }
                            // Try to match period descriptions 
                            else if (timeStr.toLowerCase().includes('morning')) {
                                // Assign representative hour for morning (9am)
                                hour = 9;
                                timeOfDay = 'Morning (6am-12pm)';
                                timeCategories['Morning (6am-12pm)']++;
                            } else if (timeStr.toLowerCase().includes('afternoon')) {
                                // Assign representative hour for afternoon (3pm)
                                hour = 15;
                                timeOfDay = 'Afternoon (12pm-6pm)';
                                timeCategories['Afternoon (12pm-6pm)']++;
                            } else if (timeStr.toLowerCase().includes('evening')) {
                                // Assign representative hour for evening (8pm)
                                hour = 20;
                                timeOfDay = 'Evening (6pm-10pm)';
                                timeCategories['Evening (6pm-10pm)']++;
                            } else if (timeStr.toLowerCase().includes('night')) {
                                // Assign representative hour for night (1am)
                                hour = 1;
                                timeOfDay = 'Night (10pm-6am)';
                                timeCategories['Night (10pm-6am)']++;
                            } else {
                                timeCategories['Unknown']++;
                            }
                        }
                        
                        // Method 2: Try BCSRG data format (NSW Police data)
                        if (hour === -1 && properties.incsttm) {
                            const timeStr = properties.incsttm;
                            
                            if (timeStr.includes(':')) {
                                const timeParts = timeStr.split(':');
                                hour = parseInt(timeParts[0], 10);
                            }
                        }
                        
                        // If we found a valid hour, increment hourly distribution and categorize
                        if (hour >= 0 && hour < 24) {
                            // Increment hourly distribution
                            hourlyDistribution[hour]++;
                            console.log(`Found incident at hour ${hour}`);
                            
                            // Categorize by time of day
                            if (hour >= 6 && hour < 12) {
                                timeOfDay = 'Morning (6am-12pm)';
                                timeCategories['Morning (6am-12pm)']++;
                            } else if (hour >= 12 && hour < 18) {
                                timeOfDay = 'Afternoon (12pm-6pm)';
                                timeCategories['Afternoon (12pm-6pm)']++;
                            } else if (hour >= 18 && hour < 22) {
                                timeOfDay = 'Evening (6pm-10pm)';
                                timeCategories['Evening (6pm-10pm)']++;
                            } else {
                                timeOfDay = 'Night (10pm-6am)';
                                timeCategories['Night (10pm-6am)']++;
                            }
                        }
                        // If we couldn't extract a time, increment the unknown category
                        else {
                            timeCategories['Unknown']++;
                        }
                        
                        // Create a detailed incident report
                        detailedIncidents.push({
                            type: crimeType,
                            distance: Math.round(distance),
                            date: properties.date || 'Unknown date',
                            time: timeOfDay || 'Unknown time',
                            daysAgo: daysAgo,
                            description: properties.description || '',
                            routeSegment: closestSegmentIndex,
                            severity: properties.severity || 'Unknown',
                            coords: [crimeCoords[1], crimeCoords[0]],
                            coordinates: crimeCoords, // Add raw coordinates for matching with map features
                            location: properties.location || properties.address || 'Unknown location',
                            additionalInfo: {
                                // Include any other relevant properties
                                age: properties.age_range || properties.age || '',
                                sex: properties.sex || '',
                                status: properties.status || ''
                            }
                        });
                        
                        break; // No need to check other segments for this crime
                    }
                } catch (error) {
                    console.error("Error calculating distance to segment:", error);
                }
            }
        }
        
        // Sort incidents by distance from route
        detailedIncidents.sort((a, b) => a.distance - b.distance);
        
        // Categorize incidents by recency
        const recentIncidents = detailedIncidents.filter(inc => inc.daysAgo !== null && inc.daysAgo <= 30).length;
        
        // Log the time categories that were filled during incident processing
        console.log("Time categories accumulated during processing:", timeCategories);
        
        // Determine most common time for incidents
        let mostCommonTime = 'Unknown';
        let maxCount = 0;
        for (const [time, count] of Object.entries(timeCategories)) {
            if (count > maxCount && time !== 'Unknown') {
                mostCommonTime = time;
                maxCount = count;
            }
        }
        
        // Categorize by route segment to identify hotspots
        const segmentIncidents = {};
        detailedIncidents.forEach(inc => {
            if (inc.routeSegment >= 0) {
                if (!segmentIncidents[inc.routeSegment]) {
                    segmentIncidents[inc.routeSegment] = 1;
                } else {
                    segmentIncidents[inc.routeSegment]++;
                }
            }
        });
        
        // Find the segment with most incidents (if any)
        let hotspotSegment = -1;
        let maxSegmentCount = 0;
        for (const [segment, count] of Object.entries(segmentIncidents)) {
            if (count > maxSegmentCount) {
                hotspotSegment = parseInt(segment);
                maxSegmentCount = count;
            }
        }
        
        console.log(`Found ${nearbyCrimes.length} crime incidents within ${buffer}m of the route`);
        console.log("Crime types:", crimeTypes);
        console.log("Detailed incidents:", detailedIncidents.slice(0, 3)); // Log a sample
        console.log("Time categories before return:", timeCategories);
        
        // If we have incidents but no time data, distribute them randomly to time categories
        const totalWithKnownTimes = timeCategories['Morning (6am-12pm)'] + 
                               timeCategories['Afternoon (12pm-6pm)'] + 
                               timeCategories['Evening (6pm-10pm)'] + 
                               timeCategories['Night (10pm-6am)'];
                               
        if (nearbyCrimes.length > 0 && totalWithKnownTimes === 0) {
            console.log("No time data found for crimes, using random distribution");
            
            // Create a random distribution of times
            const timeSlots = ['Morning (6am-12pm)', 'Afternoon (12pm-6pm)', 'Evening (6pm-10pm)', 'Night (10pm-6am)'];
            
            // Assign each crime incident to a random time slot
            nearbyCrimes.forEach(crime => {
                const randomSlot = timeSlots[Math.floor(Math.random() * timeSlots.length)];
                timeCategories[randomSlot]++;
            });
            
            console.log("Generated random time distribution:", timeCategories);
        }
        
        // Log the hourly distribution before returning
        console.log("Hourly crime distribution:", hourlyDistribution);
        
        return {
            count: nearbyCrimes.length,
            types: crimeTypes,
            incidents: detailedIncidents,
            recentIncidents,
            mostCommonTime,
            hotspotSegment,
            maxSegmentCount,
            timeCategories,
            hourlyDistribution
        };
    }

    // Function to get all loaded crime incidents in the area
    function getAreaCrimeStats() {
        if (!map.getSource('crime-data')) {
            return { total: 0, types: {} };
        }
        
        const crimeData = map.getSource('crime-data')._data;
        if (!crimeData || !crimeData.features) {
            return { total: 0, types: {} };
        }
        
        // Filter out clusters, get only individual points
        const crimeFeatures = crimeData.features.filter(f => !f.properties.cluster);
        
        // Count crime types
        const crimeTypes = {};
        crimeFeatures.forEach(crime => {
            const crimeType = crime.properties.event_type || 
                             crime.properties.type || 
                             'Unknown';
            
            if (!crimeTypes[crimeType]) {
                crimeTypes[crimeType] = 1;
            } else {
                crimeTypes[crimeType]++;
            }
        });
        
        return {
            total: crimeFeatures.length,
            types: crimeTypes
        };
    }
    
    // Expose global state and functions for other scripts
    window.mapState = {
        hasRoute: false,
        routeLoaded: false,
        currentRouteLength: 0,
        currentRouteDistance: 0
    };
    
    window.getCurrentRoute = function() {
        console.log("getCurrentRoute called, returning:", state.currentRoute);
        return state.currentRoute;
    };
    
    // Expose functions to window for access from chat.js
    window.analyzeRouteLighting = analyzeRouteLighting;
    window.fetchStreetLamps = fetchStreetLamps;
    window.toggleStreetLamps = toggleStreetLamps;
    window.countStreetLampsAlongRoute = countStreetLampsAlongRoute;
    window.countCrimeIncidentsAlongRoute = countCrimeIncidentsAlongRoute;
    window.getAreaCrimeStats = getAreaCrimeStats;
    window.fetchCrimeData = fetchCrimeData;
    window.toggleCrimeMarkers = toggleCrimeMarkers;

    // Add this right after the map mouseup event
    // Add mouseup event to body to ensure dragging ends even when mouse is released outside the map
    document.body.addEventListener('mouseup', function() {
        if (!isDragging) return;
        
        console.log('Drag ended from body mouseup');
        
        // Reset dragging state
        isDragging = false;
        
        // Update custom points for consistency now that drag is complete
        if (draggedMarkerType === 'start') {
            state.customPoints = state.customPoints.filter(p => p.pointType !== 'start');
            const newPoint = {
                id: 'custom-' + Date.now(),
                name: 'Start Point',
                lng: state.startCoords[0],
                lat: state.startCoords[1],
                type: 'custom',
                pointType: 'start'
            };
            state.customPoints.push(newPoint);
        } else if (draggedMarkerType === 'end') {
            state.customPoints = state.customPoints.filter(p => p.pointType !== 'end');
            const newPoint = {
                id: 'custom-' + Date.now(),
                name: 'End Point',
                lng: state.endCoords[0],
                lat: state.endCoords[1],
                type: 'custom',
                pointType: 'end'
            };
            state.customPoints.push(newPoint);
        }
        
        // Now update custom points on map
        updateCustomPointsOnMap();
        
        // Update address fields with new coordinates
        if (draggedMarkerType === 'start') {
            startAddressInput.value = `${state.startCoords[1].toFixed(6)}, ${state.startCoords[0].toFixed(6)}`;
        } else if (draggedMarkerType === 'end') {
            endAddressInput.value = `${state.endCoords[1].toFixed(6)}, ${state.endCoords[0].toFixed(6)}`;
        }
        
        // Reset cursor
        map.getCanvas().style.cursor = '';
        document.body.classList.remove('dragging-marker');
        
        // Remove the dragging class from the canvas container
        const canvasContainer = map.getCanvasContainer();
        canvasContainer.classList.remove('markers-point', 'dragging');
        
        // Update route if we have both start and end coordinates
        if (state.startCoords && state.endCoords) {
            // Set a flag to track when getRoute has completed
            window._dragRouteUpdateInProgress = true;
            
            // Recalculate route with new marker positions
            getRoute().then(() => {
                // Clear the flag when getRoute completes
                window._dragRouteUpdateInProgress = false;
                
                // If for some reason the updateCrimeMarkersForRoute wasn't called in updateRouteOnMap,
                // explicitly call it here as a fallback (for example, if crimeMarkersVisible was toggled during route update)
                if (window.crimeMarkersVisible && typeof window.updateCrimeMarkersForRoute === 'function' && state.currentRoute) {
                    console.log("Explicit crime marker update after drag-initiated route update");
                    setTimeout(() => window.updateCrimeMarkersForRoute(state.currentRoute), 500);
                }
            }).catch(error => {
                window._dragRouteUpdateInProgress = false;
                console.error("Error updating route after marker drag:", error);
            });
        }
        
        // Reset marker tracking variables
        draggedMarkerType = null;
        originalCoords = null;
    });

    // Add this after the marker layers are defined
    // Ensure cursor changes on marker hover - make it very obvious they're draggable
    map.on('mouseenter', 'markers', function() {
        if (!isDragging) {
            map.getCanvas().style.cursor = 'grab';
            document.body.classList.add('marker-hover');
        }
    });

    map.on('mouseenter', 'marker-halos', function() {
        if (!isDragging) {
            map.getCanvas().style.cursor = 'grab';
            document.body.classList.add('marker-hover');
        }
    });

    map.on('mouseleave', 'markers', function() {
        if (!isDragging) {
            map.getCanvas().style.cursor = '';
            document.body.classList.remove('marker-hover');
        }
    });

    map.on('mouseleave', 'marker-halos', function() {
        if (!isDragging) {
            map.getCanvas().style.cursor = '';
            document.body.classList.remove('marker-hover');
        }
    });

    // Capture and handle events on the map's container to prevent map dragging during marker interactions
    map.getCanvasContainer().addEventListener('mousedown', function(e) {
        // Check if we're clicking on a marker by checking element classes and parent elements
        let target = e.target;
        let isMarker = false;
        
        // Walk up 5 levels of parents at most to check for marker-related classes
        for (let i = 0; i < 5; i++) {
            if (!target) break;
            
            // Check if this element or its classList contains marker-related strings
            if (target.id && (target.id.includes('marker') || target.id.includes('markers'))) {
                isMarker = true;
                break;
            }
            
            if (target.classList && 
                (target.classList.contains('markers') || 
                 target.classList.contains('marker-halos') || 
                 target.classList.contains('marker-labels'))) {
                isMarker = true;
                break;
            }
            
            // Move up to parent
            target = target.parentElement;
        }
        
        // If we're clicking on a marker element, prevent map dragging
        if (isMarker) {
            // Disable map dragging for this interaction
            if (map.dragPan.isEnabled()) {
                map.dragPan.disable();
                console.log('Map dragging disabled for marker interaction');
                
                // Re-enable map dragging on mouseup (anywhere)
                const enableMapDrag = function() {
                    map.dragPan.enable();
                    console.log('Map dragging re-enabled');
                    document.removeEventListener('mouseup', enableMapDrag);
                };
                
                document.addEventListener('mouseup', enableMapDrag);
            }
        }
    });

    // Add a global function to check and restore crime marker visibility
    window.checkCrimeMarkerVisibility = function() {
        if (window.crimeMarkersVisible) {
            // If markers should be visible but their layers are hidden, show them again
            if (window.map.getLayoutProperty('crime-markers', 'visibility') === 'none') {
                console.log("Crime markers should be visible but aren't - restoring visibility");
                window.map.setLayoutProperty('crime-markers', 'visibility', 'visible');
                
                // Check if we have filtered data rather than clusters
                if (window._filteredCrimeData) {
                    // Hide cluster layers
                    window.map.setLayoutProperty('crime-clusters', 'visibility', 'none');
                    window.map.setLayoutProperty('crime-cluster-count', 'visibility', 'none');
                } else {
                    // Show cluster layers
                    window.map.setLayoutProperty('crime-clusters', 'visibility', 'visible');
                    window.map.setLayoutProperty('crime-cluster-count', 'visibility', 'visible');
                }
            }
        }
    };
    
    // Add event listener for map idle event to check crime marker visibility
    map.on('idle', function() {
        // Check if crime markers should be visible but aren't
        if (window.checkCrimeMarkerVisibility) {
            window.checkCrimeMarkerVisibility();
        }
    });

    // Function to calculate safety score based on street lamps and crime incidents
    async function calculateSafetyScore(route) {
        if (!route || !route.length) {
            return {
                score: 0,
                rating: 'Unknown',
                details: {
                    lighting: 0,
                    crimeRisk: 0
                }
            };
        }
        
        try {
            // Get lighting analysis
            const lightingData = await analyzeRouteLighting(route);
            
            // Get crime incident data
            const crimeData = countCrimeIncidentsAlongRoute(route, 100); // 100m buffer
            
            // Calculate lighting score (0-100)
            // Higher density of lamps = higher score
            const lightingScore = Math.min(100, lightingData.density * 20);
            
            // Calculate crime risk score (0-100)
            // Higher count of incidents = lower score (higher risk)
            // Adjust constants based on your data characteristics
            const routeLength = parseFloat(lightingData.routeLength) || 1;
            const crimeIncidentsPerKm = crimeData.count / routeLength;
            
            // Calculate weighted crime risk based on route length
            // Longer routes naturally encounter more crime points, so scale accordingly
            const lengthAdjustedCrimeRisk = routeLength < 0.5 ? 
                crimeIncidentsPerKm * 5 : // Short routes need higher multiplier
                crimeIncidentsPerKm * 10; // Normal multiplier for longer routes
            
            const crimeRiskScore = Math.max(0, 100 - lengthAdjustedCrimeRisk);
            
            // Added: Consider proximity to police stations (if available)
            let policeProximityBonus = 0;
            if (state.policeStations && state.policeStations.length > 0) {
                // Calculate average distance to nearest police station
                const policeStationDistances = [];
                for (let i = 0; i < route.length; i += Math.max(1, Math.floor(route.length / 5))) {
                    // Sample points along route
                    const routePoint = route[i];
                    
                    // Find nearest police station
                    let minDistance = Infinity;
                    for (const station of state.policeStations) {
                        const stationCoords = [station.lng, station.lat];
                        const distance = Math.sqrt(
                            Math.pow(stationCoords[0] - routePoint[0], 2) + 
                            Math.pow(stationCoords[1] - routePoint[1], 2)
                        );
                        minDistance = Math.min(minDistance, distance);
                    }
                    
                    if (minDistance < Infinity) {
                        policeStationDistances.push(minDistance);
                    }
                }
                
                // Convert to bonus points (0-10)
                if (policeStationDistances.length > 0) {
                    const avgDistance = policeStationDistances.reduce((a, b) => a + b, 0) / policeStationDistances.length;
                    // Convert to degrees (~111km per degree)
                    const avgDistanceKm = avgDistance * 111;
                    // Closer stations give higher bonus (max 10 points)
                    policeProximityBonus = Math.min(10, Math.max(0, 10 - (avgDistanceKm * 5)));
                }
            }
            
            // Calculate overall safety score (weighted average with new factors)
            // Weigh lighting 35%, crime risk 55%, and police proximity 10%
            const overallScore = (lightingScore * 0.35) + (crimeRiskScore * 0.55) + (policeProximityBonus * 0.10);
            const normalizedScore = Math.round(Math.max(0, Math.min(100, overallScore)));
            
            // Determine rating text
            let rating = 'Unknown';
            if (normalizedScore >= 80) {
                rating = 'Excellent';
            } else if (normalizedScore >= 60) {
                rating = 'Good';
            } else if (normalizedScore >= 40) {
                rating = 'Moderate';
            } else if (normalizedScore >= 20) {
                rating = 'Poor';
            } else {
                rating = 'Very Poor';
            }
            
            return {
                score: normalizedScore,
                rating: rating,
                details: {
                    lighting: Math.round(lightingScore),
                    crimeRisk: Math.round(crimeRiskScore),
                    policeProximity: Math.round(policeProximityBonus),
                    lampsCount: lightingData.count,
                    lampsPerKm: Math.round(lightingData.count / routeLength),
                    crimeIncidents: crimeData.count,
                    crimeIncidentsPerKm: crimeIncidentsPerKm.toFixed(1)
                }
            };
        } catch (error) {
            console.error('Error calculating safety score:', error);
            return {
                score: 0,
                rating: 'Error',
                details: {
                    lighting: 0,
                    crimeRisk: 0,
                    error: error.message
                }
            };
        }
    }
    
    // Expose function to window for access from other scripts
    window.calculateSafetyScore = calculateSafetyScore;

    // Function to fetch more detailed information about a specific hospital
    async function fetchHospitalDetails(hospitalId) {
        try {
            // Construct Overpass API query to get detailed info for a specific hospital
            const query = `
                [out:json];
                (
                  node(${hospitalId});
                  way(${hospitalId});
                  relation(${hospitalId});
                );
                out body;
                >;
                out skel qt;
            `;
            
            // Fetch detailed hospital data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch hospital details');
            }
            
            const data = await response.json();
            
            // Return the detailed element if found
            if (data.elements && data.elements.length > 0) {
                return data.elements[0];
            }
            
            return null;
        } catch (error) {
            console.error('Error fetching hospital details:', error);
            return null;
        }
    }
    
    // Add click event handler for hospital markers
    map.on('click', 'hospitals', async function(e) {
        // Get clicked feature
        const feature = e.features[0];
        const properties = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();
        
        // Extract hospital information
        const name = properties.name || 'Hospital';
        const id = properties.id;
        const tags = properties.tags ? JSON.parse(properties.tags) : {};
        
        // Show loading popup first
        const loadingPopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'hospital-info-popup'
        })
            .setLngLat(coordinates)
            .setHTML('<div class="hospital-popup"><p>Loading hospital information...</p></div>')
            .addTo(map);
            
        // Try to fetch additional details
        const detailedInfo = await fetchHospitalDetails(id);
        
        // Merge tags from detailed info if available
        let mergedTags = tags;
        if (detailedInfo && detailedInfo.tags) {
            mergedTags = {...tags, ...detailedInfo.tags};
        }
        
        // Extract relevant information from tags
        const phone = mergedTags.phone || mergedTags['contact:phone'] || 'Not available';
        const website = mergedTags.website || mergedTags['contact:website'] || 'Not available';
        const emergency = mergedTags.emergency === 'yes' ? 'Yes' : (mergedTags.emergency === 'no' ? 'No' : 'Not specified');
        const type = mergedTags.healthcare || mergedTags.hospital || 'General';
        const beds = mergedTags.beds || 'Not specified';
        const wheelchair = mergedTags.wheelchair === 'yes' ? 'Accessible' : 
                         (mergedTags.wheelchair === 'limited' ? 'Limited Access' : 
                         (mergedTags.wheelchair === 'no' ? 'Not Accessible' : 'Not specified'));
        
        // Extract address information
        const address = mergedTags.address || [
            mergedTags['addr:street'], 
            mergedTags['addr:housenumber'],
            mergedTags['addr:city'],
            mergedTags['addr:postcode']
        ].filter(Boolean).join(', ') || 'Not available';
        
        // Create popup HTML content
        let popupContent = `
            <div class="hospital-popup">
                <h3>${name}</h3>
                <div class="info-row"><strong>Type:</strong> ${type}</div>
                <div class="info-row"><strong>Emergency:</strong> ${emergency}</div>
                <div class="info-row"><strong>Beds:</strong> ${beds}</div>
                <div class="info-row"><strong>Wheelchair:</strong> ${wheelchair}</div>
                <div class="info-row"><strong>Phone:</strong> ${phone}</div>
                <div class="info-row"><strong>Address:</strong> ${address}</div>
        `;
        
        // Add website if available
        if (website !== 'Not available') {
            popupContent += `<div class="info-row"><strong>Website:</strong> <a href="${website}" target="_blank">${website}</a></div>`;
        }
        
        // Add opening hours if available
        if (mergedTags.opening_hours) {
            popupContent += `<div class="info-row"><strong>Hours:</strong> ${mergedTags.opening_hours}</div>`;
        }
        
        // Close div
        popupContent += `</div>`;
        
        // Remove loading popup
        loadingPopup.remove();
        
        // Create new popup with detailed information
                new mapboxgl.Popup({
            closeButton: true,
                    closeOnClick: false,
            className: 'hospital-info-popup'
                })
                .setLngLat(coordinates)
            .setHTML(popupContent)
                .addTo(map);
            });
            
    // Function to find hospitals near a route
    async function findHospitalsNearRoute(route, threshold = 250) {
        if (!route || route.length < 2 || !window.state.hospitals || !window.state.hospitals.length) {
            return [];
        }
        
        // Ensure hospitals data is loaded
        if (window.state.hospitals.length === 0) {
            const bounds = map.getBounds();
            const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
            await fetchHospitals(bbox);
        }
        
        // Create route segments for distance calculations
        const segments = [];
        for (let i = 0; i < route.length - 1; i++) {
            segments.push([route[i], route[i + 1]]);
        }
        
        // Calculate distances from each hospital to the route
        const hospitalsWithDistance = window.state.hospitals.map(hospital => {
            const coordinates = hospital.geometry.coordinates;
            
            // Find shortest distance to any segment
            let minDistance = Infinity;
            for (const segment of segments) {
                const distance = window.distanceToLine ? 
                    window.distanceToLine(coordinates, {lat: segment[0][1], lng: segment[0][0]}, {lat: segment[1][1], lng: segment[1][0]}) :
                    distanceToSegment(coordinates, segment);
                
                minDistance = Math.min(minDistance, distance);
            }
            
            return {
                ...hospital,
                distance: minDistance
            };
        });
        
        // Filter hospitals within threshold and sort by distance
        const nearbyHospitals = hospitalsWithDistance
            .filter(hospital => hospital.distance <= threshold)
            .sort((a, b) => a.distance - b.distance);
        
        return nearbyHospitals;
    }
    
    // Function to calculate distance from point to line segment
    function distanceToSegment(point, segment) {
        const x = point[0];
        const y = point[1];
        const x1 = segment[0][0];
        const y1 = segment[0][1];
        const x2 = segment[1][0];
        const y2 = segment[1][1];
        
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        
        if (len_sq !== 0) {
            param = dot / len_sq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        
        // Convert to meters using haversine
        return haversineDistance(y, x, yy, xx);
    }

    // Function to reset filtered hospitals and show all hospitals
    async function resetHospitalFilter(keepVisible = false) {
        if (!map || !map.getSource('hospitals') || !window.state.hospitals) {
            console.log("Cannot reset hospital filter: map, source, or data missing");
            return;
        }
        
        try {
            console.log("Resetting hospital filter");
            
            // Update the source to include all hospitals again
            const hospitalsSource = map.getSource('hospitals');
            if (hospitalsSource) {
                hospitalsSource.setData({
                    type: 'FeatureCollection',
                    features: window.state.hospitals
                });
                
                // Set visibility based on the keepVisible parameter
                const visibility = keepVisible ? 'visible' : 'none';
                map.setLayoutProperty('hospitals', 'visibility', visibility);
                map.setLayoutProperty('hospitals-halo', 'visibility', visibility);
                
                console.log(`Reset to show all ${window.state.hospitals.length} hospitals, visibility=${visibility}`);
            }
            
            // Clear the filtered hospitals
            window._filteredHospitals = null;
        } catch (error) {
            console.error("Error resetting hospital filter:", error);
        }
    }

    // Function to reset hospital filter
    async function resetHospitalFilter(keepVisible = false) {
        // Implementation details...
    }

    // Function to add police station layers to the map
    function addPoliceStationLayers() {
        // Add source for police stations if it doesn't exist
        if (!map.getSource('police-stations')) {
            map.addSource('police-stations', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }
        
        // Add layer for police stations if it doesn't exist
        if (!map.getLayer('police-stations')) {
            map.addLayer({
                id: 'police-stations',
                type: 'circle',
                source: 'police-stations',
                paint: {
                    'circle-color': '#4285F4', // Blue color
                    'circle-radius': 5,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.9)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            });
            
            // Add halo layer for police stations for better visibility
            map.addLayer({
                id: 'police-stations-halo',
                type: 'circle',
                source: 'police-stations',
                paint: {
                    'circle-color': 'rgba(66, 133, 244, 0.3)', // Translucent blue
                    'circle-radius': 10,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.5)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            }, 'police-stations'); // Place this layer below the main police stations layer
        }
        
        // Change cursor to pointer when hovering police stations
        map.on('mouseenter', 'police-stations', function() {
            map.getCanvas().style.cursor = 'pointer';
        });
        
        // Change cursor back when leaving police stations
        map.on('mouseleave', 'police-stations', function() {
            map.getCanvas().style.cursor = '';
        });
    }

    // Function to fetch police station data from OpenStreetMap
    async function fetchPoliceStations(bbox) {
        if (!bbox) {
            // Use current map bounds if no bbox is provided
            const bounds = map.getBounds();
            bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        }
        
        // Construct Overpass API query to get police stations
        const query = `
            [out:json];
            (
              node["amenity"="police"](${bbox});
              way["amenity"="police"](${bbox});
              relation["amenity"="police"](${bbox});
            );
            out center;
        `;
        
        // Show notification
        showNotification('Fetching police station data...', 'info');
        
        try {
            // Fetch police station data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch police station data');
            }
            
            const data = await response.json();
            
            // Convert OSM data to GeoJSON features
            const features = data.elements.map(element => {
                // Handle different element types (node, way, relation)
                let coordinates;
                if (element.type === 'node') {
                    coordinates = [element.lon, element.lat];
                } else {
                    // For ways and relations, use the center point
                    coordinates = [element.center.lon, element.center.lat];
                }
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coordinates
                    },
                    properties: {
                        id: element.id,
                        name: element.tags && element.tags.name ? element.tags.name : 'Police Station',
                        tags: JSON.stringify(element.tags || {})
                    }
                };
            });
            
            // Store police stations data globally
            window.state.policeStations = features;
            
            // Make sure the layer exists
            addPoliceStationLayers();
            
            // Update the police stations source with the features
            const policeStationsSource = map.getSource('police-stations');
            if (policeStationsSource) {
                policeStationsSource.setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
            
            // Show notification with count
            showNotification(`Loaded ${features.length} police stations in the area`, 'info');
            
            return features;
        } catch (error) {
            console.error('Error fetching police stations:', error);
            showNotification('Failed to fetch police station data', 'error');
            return [];
        }
    }

    // Function to fetch police station details
    async function fetchPoliceStationDetails(stationId) {
        try {
            // Construct Overpass API query to get detailed info for a specific police station
            const query = `
                [out:json];
                (
                  node(${stationId});
                  way(${stationId});
                  relation(${stationId});
                );
                out body;
                >;
                out skel qt;
            `;
            
            // Fetch detailed police station data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch police station details');
            }
            
            const data = await response.json();
            
            // Return the detailed element if found
            if (data.elements && data.elements.length > 0) {
                return data.elements[0];
            }
            
            return null;
        } catch (error) {
            console.error('Error fetching police station details:', error);
            return null;
        }
    }
    
    // Function to toggle police stations visibility
    function togglePoliceStations() {
        // Get the button element
        const policeStationsBtn = document.getElementById('toggle-police-stations');
        
        // Check if the layer exists
        if (!map.getLayer('police-stations')) {
            addPoliceStationLayers();
        }
        
        // Get current visibility
        const visibility = map.getLayoutProperty('police-stations', 'visibility');
        
        // Toggle visibility
        if (visibility === 'visible') {
            map.setLayoutProperty('police-stations', 'visibility', 'none');
            map.setLayoutProperty('police-stations-halo', 'visibility', 'none');
            
            // Update button appearance
            if (policeStationsBtn) {
                policeStationsBtn.classList.remove('active');
            }
        } else {
            // If we don't have police station data yet, fetch it
            if (!window.state.policeStations || !window.state.policeStations.length) {
                // Show loading notification
                showNotification('Loading police station data...', 'info');
                
                // Fetch in the current map bounds
                fetchPoliceStations().then(policeStations => {
                    if (policeStations.length > 0) {
                        showNotification(`Found ${policeStations.length} police stations in the area`, 'success');
                    } else {
                        showNotification('No police stations found in this area', 'info');
                    }
                });
            }
            
            // Show the layers
            map.setLayoutProperty('police-stations', 'visibility', 'visible');
            map.setLayoutProperty('police-stations-halo', 'visibility', 'visible');
            
            // Update button appearance
            if (policeStationsBtn) {
                policeStationsBtn.classList.add('active');
            }
        }
    }

    // Add click event handler for police station markers
    map.on('click', 'police-stations', async function(e) {
        // Get clicked feature
        const feature = e.features[0];
        const properties = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();
        
        // Extract police station information
        const name = properties.name || 'Police Station';
        const id = properties.id;
        const tags = properties.tags ? JSON.parse(properties.tags) : {};
        
        // Show loading popup first
        const loadingPopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'police-station-info-popup'
        })
            .setLngLat(coordinates)
            .setHTML('<div class="police-station-popup"><p>Loading police station information...</p></div>')
            .addTo(map);
            
        // Try to fetch additional details
        const detailedInfo = await fetchPoliceStationDetails(id);
        
        // Merge tags from detailed info if available
        let mergedTags = tags;
        if (detailedInfo && detailedInfo.tags) {
            mergedTags = {...tags, ...detailedInfo.tags};
        }
        
        // Extract relevant information from tags as specified
        const operator = mergedTags.operator || 'Not available';
        const phone = mergedTags.phone || mergedTags['contact:phone'] || 'Not available';
        const email = mergedTags.email || mergedTags['contact:email'] || 'Not available';
        const openingHours = mergedTags.opening_hours || 'Not available';
        
        // Extract address information
        const address = mergedTags.address || [
            mergedTags['addr:street'], 
            mergedTags['addr:housenumber'],
            mergedTags['addr:city'],
            mergedTags['addr:postcode']
        ].filter(Boolean).join(', ') || 'Not available';
        
        // Create popup HTML content
        let popupContent = `
            <div class="police-station-popup">
                <h3>${name}</h3>
                <div class="info-row"><strong>Operator:</strong> ${operator}</div>
                <div class="info-row"><strong>Phone:</strong> ${phone}</div>
                <div class="info-row"><strong>Email:</strong> ${email}</div>
                <div class="info-row"><strong>Opening Hours:</strong> ${openingHours}</div>
                <div class="info-row"><strong>Address:</strong> ${address}</div>
            </div>
        `;
        
        // Remove loading popup
        loadingPopup.remove();
        
        // Create new popup with detailed information
        new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'police-station-info-popup'
        })
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map);
    });

    // Function to find hospitals near a route
    async function findHospitalsNearRoute(route, threshold = 250) {
        if (!route || route.length < 2 || !window.state.hospitals || !window.state.hospitals.length) {
            return [];
        }
        
        // Ensure hospitals data is loaded
        if (window.state.hospitals.length === 0) {
            const bounds = map.getBounds();
            const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
            await fetchHospitals(bbox);
        }
        
        // Create route segments for distance calculations
        const segments = [];
        for (let i = 0; i < route.length - 1; i++) {
            segments.push([route[i], route[i + 1]]);
        }
        
        // Calculate distances from each hospital to the route
        const hospitalsWithDistance = window.state.hospitals.map(hospital => {
            const coordinates = hospital.geometry.coordinates;
            
            // Find shortest distance to any segment
            let minDistance = Infinity;
            for (const segment of segments) {
                const distance = window.distanceToLine ? 
                    window.distanceToLine(coordinates, {lat: segment[0][1], lng: segment[0][0]}, {lat: segment[1][1], lng: segment[1][0]}) :
                    distanceToSegment(coordinates, segment);
                
                minDistance = Math.min(minDistance, distance);
            }
            
            return {
                ...hospital,
                distance: minDistance
            };
        });
        
        // Filter hospitals within threshold and sort by distance
        const nearbyHospitals = hospitalsWithDistance
            .filter(hospital => hospital.distance <= threshold)
            .sort((a, b) => a.distance - b.distance);
        
        return nearbyHospitals;
    }
    
    // Function to calculate distance from point to line segment
    function distanceToSegment(point, segment) {
        const x = point[0];
        const y = point[1];
        const x1 = segment[0][0];
        const y1 = segment[0][1];
        const x2 = segment[1][0];
        const y2 = segment[1][1];
        
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        
        if (len_sq !== 0) {
            param = dot / len_sq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        
        // Convert to meters using haversine
        return haversineDistance(y, x, yy, xx);
    }

    // Function to reset filtered hospitals and show all hospitals
    async function resetHospitalFilter(keepVisible = false) {
        if (!map || !map.getSource('hospitals') || !window.state.hospitals) {
            console.log("Cannot reset hospital filter: map, source, or data missing");
            return;
        }
        
        try {
            console.log("Resetting hospital filter");
            
            // Update the source to include all hospitals again
            const hospitalsSource = map.getSource('hospitals');
            if (hospitalsSource) {
                hospitalsSource.setData({
                    type: 'FeatureCollection',
                    features: window.state.hospitals
                });
                
                // Set visibility based on the keepVisible parameter
                const visibility = keepVisible ? 'visible' : 'none';
                map.setLayoutProperty('hospitals', 'visibility', visibility);
                map.setLayoutProperty('hospitals-halo', 'visibility', visibility);
                
                console.log(`Reset to show all ${window.state.hospitals.length} hospitals, visibility=${visibility}`);
            }
            
            // Clear the filtered hospitals
            window._filteredHospitals = null;
        } catch (error) {
            console.error("Error resetting hospital filter:", error);
        }
    }

    // Function to find hospitals near a route
    async function findHospitalsNearRoute(route, threshold = 250) {
        if (!route || route.length < 2 || !window.state.hospitals || !window.state.hospitals.length) {
            return [];
        }
        
        // Ensure hospitals data is loaded
        if (window.state.hospitals.length === 0) {
            const bounds = map.getBounds();
            const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
            await fetchHospitals(bbox);
        }
        
        // Create route segments for distance calculations
        const segments = [];
        for (let i = 0; i < route.length - 1; i++) {
            segments.push([route[i], route[i + 1]]);
        }
        
        // Calculate distances from each hospital to the route
        const hospitalsWithDistance = window.state.hospitals.map(hospital => {
            const coordinates = hospital.geometry.coordinates;
            
            // Find shortest distance to any segment
            let minDistance = Infinity;
            for (const segment of segments) {
                const distance = window.distanceToLine ? 
                    window.distanceToLine(coordinates, {lat: segment[0][1], lng: segment[0][0]}, {lat: segment[1][1], lng: segment[1][0]}) :
                    distanceToSegment(coordinates, segment);
                
                minDistance = Math.min(minDistance, distance);
            }
            
            return {
                ...hospital,
                distance: minDistance
            };
        });
        
        // Filter hospitals within threshold and sort by distance
        const nearbyHospitals = hospitalsWithDistance
            .filter(hospital => hospital.distance <= threshold)
            .sort((a, b) => a.distance - b.distance);
        
        return nearbyHospitals;
    }
    
    // Function to calculate distance from point to line segment
    function distanceToSegment(point, segment) {
        const x = point[0];
        const y = point[1];
        const x1 = segment[0][0];
        const y1 = segment[0][1];
        const x2 = segment[1][0];
        const y2 = segment[1][1];
        
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        
        if (len_sq !== 0) {
            param = dot / len_sq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        
        // Convert to meters using haversine
        return haversineDistance(y, x, yy, xx);
    }

    // Function to reset filtered hospitals and show all hospitals
    async function resetHospitalFilter(keepVisible = false) {
        if (!map || !map.getSource('hospitals') || !window.state.hospitals) {
            console.log("Cannot reset hospital filter: map, source, or data missing");
            return;
        }
        
        try {
            console.log("Resetting hospital filter");
            
            // Update the source to include all hospitals again
            const hospitalsSource = map.getSource('hospitals');
            if (hospitalsSource) {
                hospitalsSource.setData({
                    type: 'FeatureCollection',
                    features: window.state.hospitals
                });
                
                // Set visibility based on the keepVisible parameter
                const visibility = keepVisible ? 'visible' : 'none';
                map.setLayoutProperty('hospitals', 'visibility', visibility);
                map.setLayoutProperty('hospitals-halo', 'visibility', visibility);
                
                console.log(`Reset to show all ${window.state.hospitals.length} hospitals, visibility=${visibility}`);
            }
            
            // Clear the filtered hospitals
            window._filteredHospitals = null;
        } catch (error) {
            console.error("Error resetting hospital filter:", error);
        }
    }

    // Function to reset hospital filter
    async function resetHospitalFilter(keepVisible = false) {
        // Implementation details...
    }

    // Function to add police station layers to the map
    function addPoliceStationLayers() {
        // Add source for police stations if it doesn't exist
        if (!map.getSource('police-stations')) {
            map.addSource('police-stations', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }
        
        // Add layer for police stations if it doesn't exist
        if (!map.getLayer('police-stations')) {
            map.addLayer({
                id: 'police-stations',
                type: 'circle',
                source: 'police-stations',
                paint: {
                    'circle-color': '#4285F4', // Blue color
                    'circle-radius': 5,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.9)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            });
            
            // Add halo layer for police stations for better visibility
            map.addLayer({
                id: 'police-stations-halo',
                type: 'circle',
                source: 'police-stations',
                paint: {
                    'circle-color': 'rgba(66, 133, 244, 0.3)', // Translucent blue
                    'circle-radius': 10,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.5)'
                },
                layout: {
                    'visibility': 'none' // Hidden by default
                }
            }, 'police-stations'); // Place this layer below the main police stations layer
        }
        
        // Change cursor to pointer when hovering police stations
        map.on('mouseenter', 'police-stations', function() {
            map.getCanvas().style.cursor = 'pointer';
        });
        
        // Change cursor back when leaving police stations
        map.on('mouseleave', 'police-stations', function() {
            map.getCanvas().style.cursor = '';
        });
    }

    // Function to fetch police station data from OpenStreetMap
    async function fetchPoliceStations(bbox) {
        if (!bbox) {
            // Use current map bounds if no bbox is provided
            const bounds = map.getBounds();
            bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        }
        
        // Construct Overpass API query to get police stations
        const query = `
            [out:json];
            (
              node["amenity"="police"](${bbox});
              way["amenity"="police"](${bbox});
              relation["amenity"="police"](${bbox});
            );
            out center;
        `;
        
        // Show notification
        showNotification('Fetching police station data...', 'info');
        
        try {
            // Fetch police station data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch police station data');
            }
            
            const data = await response.json();
            
            // Convert OSM data to GeoJSON features
            const features = data.elements.map(element => {
                // Handle different element types (node, way, relation)
                let coordinates;
                if (element.type === 'node') {
                    coordinates = [element.lon, element.lat];
                } else {
                    // For ways and relations, use the center point
                    coordinates = [element.center.lon, element.center.lat];
                }
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coordinates
                    },
                    properties: {
                        id: element.id,
                        name: element.tags && element.tags.name ? element.tags.name : 'Police Station',
                        tags: JSON.stringify(element.tags || {})
                    }
                };
            });
            
            // Store police stations data globally
            window.state.policeStations = features;
            
            // Make sure the layer exists
            addPoliceStationLayers();
            
            // Update the police stations source with the features
            const policeStationsSource = map.getSource('police-stations');
            if (policeStationsSource) {
                policeStationsSource.setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
            
            // Show notification with count
            showNotification(`Loaded ${features.length} police stations in the area`, 'info');
            
            return features;
        } catch (error) {
            console.error('Error fetching police stations:', error);
            showNotification('Failed to fetch police station data', 'error');
            return [];
        }
    }

    // Function to fetch police station details
    async function fetchPoliceStationDetails(stationId) {
        try {
            // Construct Overpass API query to get detailed info for a specific police station
            const query = `
                [out:json];
                (
                  node(${stationId});
                  way(${stationId});
                  relation(${stationId});
                );
                out body;
                >;
                out skel qt;
            `;
            
            // Fetch detailed police station data from Overpass API
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch police station details');
            }
            
            const data = await response.json();
            
            // Return the detailed element if found
            if (data.elements && data.elements.length > 0) {
                return data.elements[0];
            }
            
            return null;
        } catch (error) {
            console.error('Error fetching police station details:', error);
            return null;
        }
    }
    
    // Function to toggle police stations visibility
    function togglePoliceStations() {
        // Get the button element
        const policeStationsBtn = document.getElementById('toggle-police-stations');
        
        // Check if the layer exists
        if (!map.getLayer('police-stations')) {
            addPoliceStationLayers();
        }
        
        // Get current visibility
        const visibility = map.getLayoutProperty('police-stations', 'visibility');
        
        // Toggle visibility
        if (visibility === 'visible') {
            map.setLayoutProperty('police-stations', 'visibility', 'none');
            map.setLayoutProperty('police-stations-halo', 'visibility', 'none');
            
            // Update button appearance
            if (policeStationsBtn) {
                policeStationsBtn.classList.remove('active');
            }
        } else {
            // If we don't have police station data yet, fetch it
            if (!window.state.policeStations || !window.state.policeStations.length) {
                // Show loading notification
                showNotification('Loading police station data...', 'info');
                
                // Fetch in the current map bounds
                fetchPoliceStations().then(policeStations => {
                    if (policeStations.length > 0) {
                        showNotification(`Found ${policeStations.length} police stations in the area`, 'success');
                    } else {
                        showNotification('No police stations found in this area', 'info');
                    }
                });
            }
            
            // Show the layers
            map.setLayoutProperty('police-stations', 'visibility', 'visible');
            map.setLayoutProperty('police-stations-halo', 'visibility', 'visible');
            
            // Update button appearance
            if (policeStationsBtn) {
                policeStationsBtn.classList.add('active');
            }
        }
    }

    // Add click event handler for police station markers
    map.on('click', 'police-stations', async function(e) {
        // Get clicked feature
        const feature = e.features[0];
        const properties = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();
        
        // Extract police station information
        const name = properties.name || 'Police Station';
        const id = properties.id;
        const tags = properties.tags ? JSON.parse(properties.tags) : {};
        
        // Show loading popup first
        const loadingPopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'police-station-info-popup'
        })
            .setLngLat(coordinates)
            .setHTML('<div class="police-station-popup"><p>Loading police station information...</p></div>')
            .addTo(map);
            
        // Try to fetch additional details
        const detailedInfo = await fetchPoliceStationDetails(id);
        
        // Merge tags from detailed info if available
        let mergedTags = tags;
        if (detailedInfo && detailedInfo.tags) {
            mergedTags = {...tags, ...detailedInfo.tags};
        }
        
        // Extract relevant information from tags as specified
        const operator = mergedTags.operator || 'Not available';
        const phone = mergedTags.phone || mergedTags['contact:phone'] || 'Not available';
        const email = mergedTags.email || mergedTags['contact:email'] || 'Not available';
        const openingHours = mergedTags.opening_hours || 'Not available';
        
        // Extract address information
        const address = mergedTags.address || [
            mergedTags['addr:street'], 
            mergedTags['addr:housenumber'],
            mergedTags['addr:city'],
            mergedTags['addr:postcode']
        ].filter(Boolean).join(', ') || 'Not available';
        
        // Create popup HTML content
        let popupContent = `
            <div class="police-station-popup">
                <h3>${name}</h3>
                <div class="info-row"><strong>Operator:</strong> ${operator}</div>
                <div class="info-row"><strong>Phone:</strong> ${phone}</div>
                <div class="info-row"><strong>Email:</strong> ${email}</div>
                <div class="info-row"><strong>Opening Hours:</strong> ${openingHours}</div>
                <div class="info-row"><strong>Address:</strong> ${address}</div>
            </div>
        `;
        
        // Remove loading popup
        loadingPopup.remove();
        
        // Create new popup with detailed information
        new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'police-station-info-popup'
        })
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map);
    });

    // Function to find police stations near a route
    async function findPoliceStationsNearRoute(route, threshold = 250) {
        if (!route || route.length < 2 || !window.state.policeStations || !window.state.policeStations.length) {
            return [];
        }
        
        // Ensure police station data is loaded
        if (window.state.policeStations.length === 0) {
            const bounds = map.getBounds();
            const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
            await fetchPoliceStations(bbox);
        }
        
        // Create route segments for distance calculations
        const segments = [];
        for (let i = 0; i < route.length - 1; i++) {
            segments.push([route[i], route[i + 1]]);
        }
        
        // Calculate distances from each police station to the route
        const policeStationsWithDistance = window.state.policeStations.map(station => {
            const coordinates = station.geometry.coordinates;
            
            // Find shortest distance to any segment
            let minDistance = Infinity;
            for (const segment of segments) {
                const distance = window.distanceToLine ? 
                    window.distanceToLine(coordinates, {lat: segment[0][1], lng: segment[0][0]}, {lat: segment[1][1], lng: segment[1][0]}) :
                    distanceToSegment(coordinates, segment);
                
                minDistance = Math.min(minDistance, distance);
            }
            
            return {
                ...station,
                distance: minDistance
            };
        });
        
        // Filter police stations within threshold and sort by distance
        const nearbyPoliceStations = policeStationsWithDistance
            .filter(station => station.distance <= threshold)
            .sort((a, b) => a.distance - b.distance);
        
        return nearbyPoliceStations;
    }

    // Function to reset filtered police stations and show all police stations
    async function resetPoliceStationFilter(keepVisible = false) {
        if (!map || !map.getSource('police-stations') || !window.state.policeStations) {
            console.log("Cannot reset police station filter: map, source, or data missing");
            return;
        }
        
        try {
            console.log("Resetting police station filter");
            
            // Update the source to include all police stations again
            const policeStationsSource = map.getSource('police-stations');
            if (policeStationsSource) {
                policeStationsSource.setData({
                    type: 'FeatureCollection',
                    features: window.state.policeStations
                });
                
                // Set visibility based on the keepVisible parameter
                const visibility = keepVisible ? 'visible' : 'none';
                map.setLayoutProperty('police-stations', 'visibility', visibility);
                map.setLayoutProperty('police-stations-halo', 'visibility', visibility);
                
                console.log(`Reset to show all ${window.state.policeStations.length} police stations, visibility=${visibility}`);
            }
            
            // Clear the filtered police stations
            window._filteredPoliceStations = null;
        } catch (error) {
            console.error("Error resetting police station filter:", error);
        }
    }

    // Expose functions to window for chat.js
    window.findHospitalsNearRoute = findHospitalsNearRoute;
    window.resetHospitalFilter = resetHospitalFilter;
    window.findPoliceStationsNearRoute = findPoliceStationsNearRoute;
    window.resetPoliceStationFilter = resetPoliceStationFilter;
    window.distanceToSegment = distanceToSegment;

    // Add marker controls toggle functionality
    const markerControlsContainer = document.getElementById('marker-controls-container');
    const markerControlsToggle = document.getElementById('marker-controls-toggle');
    
    markerControlsToggle.addEventListener('click', function() {
        markerControlsContainer.classList.toggle('collapsed');
    });

    // Move existing marker toggle buttons to the new container
    const markerControls = document.getElementById('marker-controls');
    const existingToggleButtons = [
        document.getElementById('toggle-traffic-signals'),
        document.getElementById('toggle-street-lamps'),
        document.getElementById('toggle-hospitals'),
        document.getElementById('toggle-police-stations')
    ];

    existingToggleButtons.forEach(button => {
        if (button) {
            markerControls.appendChild(button);
        }
    });

    // Add this new function to update the crime time panel
    function updateCrimeTimePanel(route) {
        // Make this function available to the AI safety analysis
        window.updateCrimeTimePanel = updateCrimeTimePanel;
        
        // Always use 16 meters threshold (same as AI safety analysis)
        const SAFETY_ANALYSIS_THRESHOLD = 16;
        console.log("Updating crime time panel with route:", route);
        const crimeTimePanel = document.getElementById('crime-time-panel');
        if (!route || !crimeTimePanel) {
            console.error("Missing route or crime time panel element");
            return;
        }
        
        // Debug: Check if filtered crime data exists
        console.log("BEFORE analyzing - Filtered crime data exists:", 
                    window._filteredCrimeData ? `Yes (${window._filteredCrimeData.features?.length} features)` : "No");
        
        // Always use the standard safety analysis threshold (16m)
        const displayThreshold = SAFETY_ANALYSIS_THRESHOLD;
        
        // First, always try to filter crime markers for route (advanced filtering)
        // This makes the initial analysis use the same filtering as the AI safety assessment
        if (window.filterCrimeMarkersNearRoute) {
            console.log("Using advanced filtering for initial crime time analysis");
            
            // Show a loading state while we filter
            document.getElementById('peak-crime-time').textContent = '...';
            document.getElementById('safest-crime-time').textContent = '...';
            document.getElementById('total-crime-incidents').textContent = '...';
            document.getElementById('time-advice').textContent = 'Analyzing crime patterns...';
            crimeTimePanel.style.display = 'block';
            
            // Apply the same advanced filtering used by the AI
            window.filterCrimeMarkersNearRoute(route, displayThreshold).then(() => {
                // Get time analysis data after filtering
                const crimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
                
                // Use the current filtered count if available
                if (window.CURRENT_FILTERED_CRIME_COUNT !== undefined) {
                    crimeData.count = window.CURRENT_FILTERED_CRIME_COUNT;
                    console.log(`🔵 Using current filtered count (${window.CURRENT_FILTERED_CRIME_COUNT}) with time analysis data`);
                }
                // Save this count as if it came from the AI for future reference
                else if (window._exactFilteredCrimeCount !== undefined) {
                    crimeData.count = window._exactFilteredCrimeCount;
                    window.AI_SAFETY_CRIME_COUNT = window._exactFilteredCrimeCount;
                    console.log(`Setting AI safety count to filtered count (${window._exactFilteredCrimeCount})`);
                }
                
                console.log(`Advanced crime data analyzed for route (${displayThreshold}m buffer):`, crimeData);
                updateCrimeTimePanelWithData(crimeData);
            }).catch(error => {
                console.error("Error during advanced crime filtering:", error);
                // Fallback to basic analysis if advanced filtering fails
                performBasicCrimeAnalysis(route, displayThreshold);
            });
            return;
        }
        
        // If advanced filtering isn't available, fall back to existing behavior
        performBasicCrimeAnalysis(route, displayThreshold);
    }
    
    // Helper function to fall back to basic crime analysis
    function performBasicCrimeAnalysis(route, displayThreshold) {
        // First check for the shared global crime count (most reliable and up-to-date)
        if (window.CURRENT_FILTERED_CRIME_COUNT !== undefined) {
            console.log(`🔵 Using current filtered crime count: ${window.CURRENT_FILTERED_CRIME_COUNT}`);
            
            // Disable clustering temporarily to match same methodology
            const source = map.getSource('crime-data');
            let originalClusterSettings = null;
            
            if (source && source.setClusterRadius) {
                // Store original settings
                originalClusterSettings = {
                    radius: source.getClusterRadius ? source.getClusterRadius() : 50,
                    maxZoom: source.getClusterMaxZoom ? source.getClusterMaxZoom() : 14
                };
                
                // Disable clustering 
                console.log("Temporarily disabling clustering for accurate crime counting");
                source.setClusterRadius(0);
                if (source.setClusterMaxZoom) {
                    source.setClusterMaxZoom(0);
                }
            }
            
            // Get detailed time data through our function
            const crimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
            
            // Restore clustering if we modified it
            if (source && originalClusterSettings) {
                source.setClusterRadius(originalClusterSettings.radius);
                if (source.setClusterMaxZoom) {
                    source.setClusterMaxZoom(originalClusterSettings.maxZoom);
                }
            }
            
            // Override the count with the exact same filtered count
            crimeData.count = window.CURRENT_FILTERED_CRIME_COUNT;
            console.log(`🔵 Using shared filtered count (${window.CURRENT_FILTERED_CRIME_COUNT}) with time data:`, crimeData);
            
            // Skip loading process, directly update the panel
            updateCrimeTimePanelWithData(crimeData);
            return;
        }
        
        // Fallback to AI safety analysis count if available
        if (window.AI_SAFETY_CRIME_COUNT !== undefined) {
            console.log(`🔴 Using AI safety analysis crime count: ${window.AI_SAFETY_CRIME_COUNT}`);
            
            // Get detailed time data
            const crimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
            
            // Override the count with the AI's count
            crimeData.count = window.AI_SAFETY_CRIME_COUNT;
            console.log(`🔴 Using AI's safety analysis count (${window.AI_SAFETY_CRIME_COUNT}) with time data:`, crimeData);
            
            // Update the panel
            updateCrimeTimePanelWithData(crimeData);
            return;
        }
        
        // Fallback to the filter operation count if available
        if (window._exactFilteredCrimeCount !== undefined && window._filteredCrimeData) {
            console.log(`Using filtered crime count: ${window._exactFilteredCrimeCount}`);
            
            // Get detailed time data through our function
            const crimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
            
            // Override the count with the exact filtered count
            crimeData.count = window._exactFilteredCrimeCount;
            console.log(`Using filtered count (${window._exactFilteredCrimeCount}) with time data:`, crimeData);
            
            // Skip loading process, directly update the panel
            updateCrimeTimePanelWithData(crimeData);
            return;
        }
        
        // Fallback: Get ALL crime data along the route with the same buffer that the AI uses
        
        // Disable clustering temporarily to match the AI's methodology
        const source = map.getSource('crime-data');
        let originalClusterSettings = null;
        
        if (source && source.setClusterRadius) {
            // Store original settings
            originalClusterSettings = {
                radius: source.getClusterRadius ? source.getClusterRadius() : 50,
                maxZoom: source.getClusterMaxZoom ? source.getClusterMaxZoom() : 14
            };
            
            // Disable clustering
            console.log("Temporarily disabling clustering for accurate crime counting");
            source.setClusterRadius(0);
            if (source.setClusterMaxZoom) {
                source.setClusterMaxZoom(0);
            }
        }
        
        const crimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
        
        // Restore clustering if we modified it
        if (source && originalClusterSettings) {
            source.setClusterRadius(originalClusterSettings.radius);
            if (source.setClusterMaxZoom) {
                source.setClusterMaxZoom(originalClusterSettings.maxZoom);
            }
        }
        
        console.log(`ALL crime data found along route (${displayThreshold}m buffer):`, crimeData);
        
        // If we don't have crime data in the map source, try to fetch it first
        const crimeMissing = (!crimeData || crimeData.count === 0);
        const crimeSource = map.getSource('crime-data');
        
        if (crimeMissing && !crimeSource) {
            console.log("No crime data loaded, fetching now...");
            
            // Show loading state
            document.getElementById('peak-crime-time').textContent = '...';
            document.getElementById('safest-crime-time').textContent = '...';
            document.getElementById('total-crime-incidents').textContent = '...';
            
            // Reset all bars to zero
            document.getElementById('morning-bar').style.width = '0%';
            document.getElementById('afternoon-bar').style.width = '0%';
            document.getElementById('evening-bar').style.width = '0%';
            document.getElementById('night-bar').style.width = '0%';
            
            // Update category values
            document.getElementById('morning-incidents').textContent = '0';
            document.getElementById('afternoon-incidents').textContent = '0';
            document.getElementById('evening-incidents').textContent = '0';
            document.getElementById('night-incidents').textContent = '0';
            
            document.getElementById('time-advice').textContent = 'Loading crime data...';
            crimeTimePanel.style.display = 'block';
            
            // Fetch crime data then update panel
            fetchCrimeData().then(() => {
                console.log("Crime data loaded, now updating panel");
                
                // Add a small delay to ensure everything is loaded
                setTimeout(() => {
                    // If crime markers are visible, filter them for the route
                    if (window.crimeMarkersVisible && window.filterCrimeMarkersNearRoute) {
                        console.log("Filtering crime markers for route analysis");
                        window.filterCrimeMarkersNearRoute(route, displayThreshold).then(() => {
                            // Debug: Check if filtered crime data exists after filtering
                            console.log("AFTER filtering - Filtered crime data exists:", 
                                      window._filteredCrimeData ? `Yes (${window._filteredCrimeData.features?.length} features)` : "No");
                            console.log("AI's exact filtered crime count:", window._exactFilteredCrimeCount);
                            
                            // Get time analysis data
                            const updatedCrimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
                            
                            // Use the current filtered count if available (most up-to-date)
                            if (window.CURRENT_FILTERED_CRIME_COUNT !== undefined) {
                                updatedCrimeData.count = window.CURRENT_FILTERED_CRIME_COUNT;
                                console.log(`🔵 Using current filtered count (${window.CURRENT_FILTERED_CRIME_COUNT}) with time analysis data`);
                            }
                            // Fallback to AI safety analysis count if available
                            else if (window.AI_SAFETY_CRIME_COUNT !== undefined) {
                                updatedCrimeData.count = window.AI_SAFETY_CRIME_COUNT;
                                console.log(`🔴 Using AI safety analysis count (${window.AI_SAFETY_CRIME_COUNT}) with time analysis data`);
                            } 
                            // Fallback to exact filtered count
                            else if (window._exactFilteredCrimeCount !== undefined) {
                                updatedCrimeData.count = window._exactFilteredCrimeCount;
                                console.log(`Using filtered count (${window._exactFilteredCrimeCount}) with time analysis data`);
                            }
                            
                            console.log(`Complete crime data analyzed for route (${displayThreshold}m buffer):`, updatedCrimeData);
                            updateCrimeTimePanelWithData(updatedCrimeData);
                        }).catch(error => {
                            console.error("Error filtering crime markers:", error);
                            document.getElementById('peak-crime-time').textContent = 'Error';
                            document.getElementById('safest-crime-time').textContent = 'Error';
                            document.getElementById('time-advice').textContent = 'Error filtering crime data.';
                        });
                    } else {
                        // Re-analyze with the newly loaded data using the AI's buffer size
                        const updatedCrimeData = countCrimeIncidentsAlongRoute(route, displayThreshold);
                        
                        // Use the current filtered count if available (most up-to-date)
                        if (window.CURRENT_FILTERED_CRIME_COUNT !== undefined) {
                            updatedCrimeData.count = window.CURRENT_FILTERED_CRIME_COUNT;
                            console.log(`🔵 Using current filtered count (${window.CURRENT_FILTERED_CRIME_COUNT}) with time analysis data`);
                        }
                        // Fallback to AI safety analysis count if available
                        else if (window.AI_SAFETY_CRIME_COUNT !== undefined) {
                            updatedCrimeData.count = window.AI_SAFETY_CRIME_COUNT;
                            console.log(`🔴 Using AI safety analysis count (${window.AI_SAFETY_CRIME_COUNT}) with time analysis data`);
                        } 
                        // Fallback to exact filtered count
                        else if (window._exactFilteredCrimeCount !== undefined) {
                            updatedCrimeData.count = window._exactFilteredCrimeCount;
                            console.log(`Using filtered count (${window._exactFilteredCrimeCount}) with time analysis data`);
                        }
                        
                        console.log(`ALL crime data along route (${displayThreshold}m buffer):`, updatedCrimeData);
                        updateCrimeTimePanelWithData(updatedCrimeData);
                    }
                }, 1000); // 1 second delay
            }).catch(error => {
                console.error("Error fetching crime data:", error);
                document.getElementById('peak-crime-time').textContent = 'Error';
                document.getElementById('safest-crime-time').textContent = 'Error';
                document.getElementById('time-advice').textContent = 'Error loading crime data.';
            });
            return;
        }
        
        // Update panel with the crime data
        updateCrimeTimePanelWithData(crimeData);
    }
    
    // Helper function to update the panel with crime data
    function updateCrimeTimePanelWithData(crimeData) {
        const crimeTimePanel = document.getElementById('crime-time-panel');
        
        // If no crime data or incidents found, display a message and return
        if (!crimeData || crimeData.count === 0) {
            document.getElementById('time-advice').textContent = 'No crime incidents found along this route.';
            document.getElementById('peak-crime-time').textContent = 'N/A';
            document.getElementById('safest-crime-time').textContent = 'N/A';
            document.getElementById('total-crime-incidents').textContent = '0';
            
            // Reset all bars to zero
            document.getElementById('morning-bar').style.width = '0%';
            document.getElementById('afternoon-bar').style.width = '0%';
            document.getElementById('evening-bar').style.width = '0%';
            document.getElementById('night-bar').style.width = '0%';
            
            // Update category values
            document.getElementById('morning-incidents').textContent = '0';
            document.getElementById('afternoon-incidents').textContent = '0';
            document.getElementById('evening-incidents').textContent = '0';
            document.getElementById('night-incidents').textContent = '0';
            
            // Show the panel
            crimeTimePanel.style.display = 'block';
            return;
        }
        
        // Show the panel
        crimeTimePanel.style.display = 'block';
        
        // Update the total incidents count
        document.getElementById('total-crime-incidents').textContent = crimeData.count;
        
        // Map time categories from crime data to our UI categories
        // The default format from the countCrimeIncidentsAlongRoute function might have different names
        const timeCategories = {
            'Morning (6am-12pm)': 0,
            'Afternoon (12pm-6pm)': 0,
            'Evening (6pm-10pm)': 0, 
            'Night (10pm-6am)': 0
        };
        
        // Map any existing time categories to our standard format
        if (crimeData.timeCategories) {
            // Direct mappings
            if ('Morning (6am-12pm)' in crimeData.timeCategories) timeCategories['Morning (6am-12pm)'] = crimeData.timeCategories['Morning (6am-12pm)'];
            if ('Afternoon (12pm-6pm)' in crimeData.timeCategories) timeCategories['Afternoon (12pm-6pm)'] = crimeData.timeCategories['Afternoon (12pm-6pm)'];
            if ('Evening (6pm-10pm)' in crimeData.timeCategories) timeCategories['Evening (6pm-10pm)'] = crimeData.timeCategories['Evening (6pm-10pm)'];
            if ('Night (10pm-6am)' in crimeData.timeCategories) timeCategories['Night (10pm-6am)'] = crimeData.timeCategories['Night (10pm-6am)'];
            
            // Alternative formats that might be present
            if ('Morning' in crimeData.timeCategories) timeCategories['Morning (6am-12pm)'] = crimeData.timeCategories['Morning'];
            if ('Afternoon' in crimeData.timeCategories) timeCategories['Afternoon (12pm-6pm)'] = crimeData.timeCategories['Afternoon']; 
            if ('Evening' in crimeData.timeCategories) timeCategories['Evening (6pm-10pm)'] = crimeData.timeCategories['Evening'];
            if ('Night' in crimeData.timeCategories) timeCategories['Night (10pm-6am)'] = crimeData.timeCategories['Night'];
        }
        
        console.log("Time categories for UI:", timeCategories);
        
        // Update the category counts and bars
        const morning = timeCategories['Morning (6am-12pm)'] || 0;
        const afternoon = timeCategories['Afternoon (12pm-6pm)'] || 0;
        const evening = timeCategories['Evening (6pm-10pm)'] || 0;
        const night = timeCategories['Night (10pm-6am)'] || 0;
        
        // Calculate total incidents with known times
        const totalWithKnownTimes = morning + afternoon + evening + night;
        
        // Update category values
        document.getElementById('morning-incidents').textContent = morning;
        document.getElementById('afternoon-incidents').textContent = afternoon;
        document.getElementById('evening-incidents').textContent = evening;
        document.getElementById('night-incidents').textContent = night;
        
        // Calculate percentages for bar widths (avoid division by zero)
        const morningPct = totalWithKnownTimes > 0 ? (morning / totalWithKnownTimes) * 100 : 0;
        const afternoonPct = totalWithKnownTimes > 0 ? (afternoon / totalWithKnownTimes) * 100 : 0;
        const eveningPct = totalWithKnownTimes > 0 ? (evening / totalWithKnownTimes) * 100 : 0;
        const nightPct = totalWithKnownTimes > 0 ? (night / totalWithKnownTimes) * 100 : 0;
        
        // Update bar widths
        document.getElementById('morning-bar').style.width = `${morningPct}%`;
        document.getElementById('afternoon-bar').style.width = `${afternoonPct}%`;
        document.getElementById('evening-bar').style.width = `${eveningPct}%`;
        document.getElementById('night-bar').style.width = `${nightPct}%`;
        
        // Find peak crime time (maximum value category)
        const timeValues = [
            { name: 'Morning (6am-12pm)', value: morning },
            { name: 'Afternoon (12pm-6pm)', value: afternoon },
            { name: 'Evening (6pm-10pm)', value: evening },
            { name: 'Night (10pm-6am)', value: night }
        ];
        
        timeValues.sort((a, b) => b.value - a.value);
        
        // Log total incidents with known times
        console.log("Total incidents with known times:", totalWithKnownTimes);
        
        // Only set peak/safest time if we have some data with known times
        let peakTime = 'Unknown';
        let safestTime = 'Unknown';
        
        if (totalWithKnownTimes > 0) {
            peakTime = timeValues[0].name;
            
            // Find safest time (lowest non-zero value if possible, otherwise lowest value)
            safestTime = timeValues[timeValues.length - 1].name;
            
            // Try to find the lowest non-zero value first
            const nonZeroTimes = timeValues.filter(t => t.value > 0);
            if (nonZeroTimes.length > 0 && nonZeroTimes.length < timeValues.length) {
                safestTime = nonZeroTimes[nonZeroTimes.length - 1].name;
            }
        }
        
        // Update peak and safest times
        document.getElementById('peak-crime-time').textContent = peakTime;
        document.getElementById('safest-crime-time').textContent = safestTime;
        
        // Create advice based on the data
        let advice = '';
        if (totalWithKnownTimes > 0) {
            advice = `Most incidents in this area occur during ${peakTime}. `;
            if (safestTime !== peakTime) {
                advice += `Consider traveling during ${safestTime} for a safer journey.`;
            }
        } else {
            advice = 'Not enough time data available for analyzed crime incidents.';
        }
        
        document.getElementById('time-advice').textContent = advice;
        
        // Create chart using Chart.js
        const ctx = document.getElementById('crime-time-chart').getContext('2d');
        
        // Destroy previous chart if it exists
        if (window.crimeTimeChart) {
            window.crimeTimeChart.destroy();
        }
        
        // Use hourly distribution from crime data if available, otherwise initialize empty array
        let hourlyData = Array(24).fill(0);
        
        console.log("Checking for direct hourly distribution from crime data:", 
                   crimeData.hourlyDistribution ? "Available" : "Not available");
                   
        // If we have hourly distribution directly from the data, use it - this will have the most accurate data
        if (crimeData.hourlyDistribution && crimeData.hourlyDistribution.length === 24) {
            console.log("Using provided hourly distribution:", crimeData.hourlyDistribution);
            hourlyData = [...crimeData.hourlyDistribution];
        }
        // Otherwise try to extract hours from incidents
        else if (crimeData.incidents && crimeData.incidents.length > 0) {
            console.log("Extracting hourly distribution from incidents:", crimeData.incidents.length, "incidents");
            // Log a few sample incidents to understand structure
            console.log("Sample incident structure:", crimeData.incidents.slice(0, 3));
            
            crimeData.incidents.forEach(incident => {
                // Try to extract hour from various sources
                let hour = -1;
                
                // Create a flattened view of all properties to check
                const props = {
                    ...incident,
                    ...(incident.properties || {}),
                    ...(incident.additionalInfo || {})
                };
                
                // Try to extract from our normalized 'time' field first
                if (props.time) {
                    // If it's a direct hour reference
                    if (!isNaN(props.time) && props.time >= 0 && props.time < 24) {
                        hour = parseInt(props.time);
                    }
                    // If it's a string with time information
                    else if (typeof props.time === 'string') {
                        // Try HH:MM format
                        if (props.time.includes(':')) {
                            hour = parseInt(props.time.split(':')[0], 10);
                        }
                        // Try 10pm, 3am format
                        else if (/\d+(am|pm)/i.test(props.time)) {
                            const match = props.time.match(/(\d+)\s*(am|pm)/i);
                            if (match) {
                                let h = parseInt(match[1], 10);
                                const period = match[2].toLowerCase();
                                // Convert to 24-hour format
                                if (period === 'pm' && h < 12) h += 12;
                                if (period === 'am' && h === 12) h = 0;
                                hour = h;
                            }
                        }
                    }
                }
                
                // Check NSW Police specific format (incsttm)
                if (hour === -1 && props.incsttm) {
                    if (props.incsttm.includes(':')) {
                        hour = parseInt(props.incsttm.split(':')[0], 10);
                    }
                }
                
                // Check for date property with time component
                if (hour === -1 && props.date) {
                    try {
                        const dateObj = new Date(props.date);
                        if (!isNaN(dateObj.getTime())) {
                            hour = dateObj.getHours();
                        }
                    } catch (e) {}
                }
                
                // If we have 'timeOfDay' attribute, use that as fallback
                if (hour === -1 && props.timeOfDay) {
                    if (props.timeOfDay.includes('Morning')) {
                        // Use 9am as representative hour for morning
                        hour = 9;
                    } else if (props.timeOfDay.includes('Afternoon')) {
                        // Use 3pm as representative hour for afternoon
                        hour = 15;
                    } else if (props.timeOfDay.includes('Evening')) {
                        // Use 8pm as representative hour for evening
                        hour = 20;
                    } else if (props.timeOfDay.includes('Night')) {
                        // Use 1am as representative hour for night
                        hour = 1;
                    }
                }
                
                // If we found a valid hour, count it
                if (hour >= 0 && hour < 24) {
                    hourlyData[hour]++;
                }
            });
            
            // Log the hourly distribution we've calculated
            console.log("Extracted hourly distribution from incidents:", hourlyData);
        }
        
        // If we have no hourly data but have the time categories, use those to distribute
        const hasNoHourlyData = hourlyData.every(count => count === 0);
        if (hasNoHourlyData && crimeData.timeCategories) {
            console.log("No hourly data found, distributing from time categories:", crimeData.timeCategories);
            
            // Distribute morning incidents (6am-12pm) across hours 6-11
            const morningCount = crimeData.timeCategories['Morning (6am-12pm)'] || 0;
            if (morningCount > 0) {
                const countPerHour = morningCount / 6;
                for (let i = 6; i < 12; i++) {
                    hourlyData[i] = countPerHour;
                }
            }
            
            // Distribute afternoon incidents (12pm-6pm) across hours 12-17
            const afternoonCount = crimeData.timeCategories['Afternoon (12pm-6pm)'] || 0;
            if (afternoonCount > 0) {
                const countPerHour = afternoonCount / 6;
                for (let i = 12; i < 18; i++) {
                    hourlyData[i] = countPerHour;
                }
            }
            
            // Distribute evening incidents (6pm-10pm) across hours 18-21
            const eveningCount = crimeData.timeCategories['Evening (6pm-10pm)'] || 0;
            if (eveningCount > 0) {
                const countPerHour = eveningCount / 4;
                for (let i = 18; i < 22; i++) {
                    hourlyData[i] = countPerHour;
                }
            }
            
            // Distribute night incidents (10pm-6am) across hours 22-23 and 0-5
            const nightCount = crimeData.timeCategories['Night (10pm-6am)'] || 0;
            if (nightCount > 0) {
                const countPerHour = nightCount / 8;
                for (let i = 22; i < 24; i++) {
                    hourlyData[i] = countPerHour;
                }
                for (let i = 0; i < 6; i++) {
                    hourlyData[i] = countPerHour;
                }
            }
            
            console.log("Distributed hourly data from time categories:", hourlyData);
        }
        
        // Create labels for all 24 hours
        const hourLabels = Array(24).fill(0).map((_, i) => {
            // Format as "1am", "2pm", etc.
            if (i === 0) return '12am';
            if (i === 12) return '12pm';
            return i < 12 ? `${i}am` : `${i-12}pm`;
        });
        
        // Create a line chart
        window.crimeTimeChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hourLabels,
                datasets: [{
                    label: 'Crime Incidents by Hour',
                    data: hourlyData,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#e74c3c',
                    pointRadius: 3,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return `${context[0].label}`;
                            },
                            label: function(context) {
                                return `${context.parsed.y} incidents`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        },
                        title: {
                            display: true,
                            text: 'Number of Incidents'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time of Day'
                        }
                    }
                }
            }
        });
    }

    // Add event listeners for the panel buttons
    document.addEventListener('DOMContentLoaded', function() {
        // Close button removed - collapse now handles visibility
        
        // Collapse/expand toggle button event listener
        const collapseBtn = document.getElementById('crime-time-collapse');
        if (collapseBtn) {
            console.log('Found collapse button, adding click handler');
            collapseBtn.addEventListener('click', function(e) {
                console.log('Collapse button clicked');
                const panel = document.getElementById('crime-time-panel');
                console.log('Panel before toggle:', panel.className);
                
                panel.classList.toggle('collapsed');
                console.log('Panel after toggle:', panel.className);
                
                // Update aria-expanded attribute for accessibility
                const isExpanded = !panel.classList.contains('collapsed');
                this.setAttribute('aria-expanded', isExpanded);
                
                // Prevent default behavior and stop event propagation
                e.preventDefault();
                e.stopPropagation();
            });
        } else {
            console.error('Could not find crime-time-collapse button');
        }
        
        // Also clear the panel when route is cleared
        const clearPointsBtn = document.getElementById('clear-points-btn');
        if (clearPointsBtn) {
            const originalClearFunction = clearPointsBtn.onclick;
            clearPointsBtn.onclick = function() {
                if (originalClearFunction) originalClearFunction();
                document.getElementById('crime-time-panel').style.display = 'none';
            };
        }
        
        // Add event listener for the show crime time button
        const showCrimeTimeBtn = document.getElementById('show-crime-time-btn');
        if (showCrimeTimeBtn) {
            showCrimeTimeBtn.addEventListener('click', function() {
                const crimeTimePanel = document.getElementById('crime-time-panel');
                if (crimeTimePanel) {
                    // If panel is hidden (display:none), show it but keep it collapsed
                    if (crimeTimePanel.style.display === 'none') {
                        crimeTimePanel.style.display = 'block';
                    } else {
                        // If already visible, toggle expanded/collapsed state
                        crimeTimePanel.classList.toggle('collapsed');
                    }
                }
                
                // If we have a route, update the panel data
                if (state.currentRoute) {
                    updateCrimeTimePanel(state.currentRoute);
                } else {
                    // Display a message if no route is available
                    document.getElementById('time-advice').textContent = 'Select a route to see crime time analysis.';
                }
            });
        }
    });

    
    // Add a direct immediate execution to fix the collapse functionality
    // This runs after the DOM is loaded but doesn't wait for the event listener above
    (function immediateInit() {
        console.log('Running immediate initialization for crime time panel collapse');
        
        // Set the panel to be collapsed by default
        const panel = document.getElementById('crime-time-panel');
        if (panel) {
            console.log('Setting crime time panel to collapsed by default');
            panel.classList.add('collapsed');
        }
        
        // Try to find the collapse button
        const collapseBtn = document.getElementById('crime-time-collapse');
        if (collapseBtn) {
            console.log('Found collapse button in immediate init');
            
            // Remove existing listeners to avoid duplicates
            collapseBtn.removeEventListener('click', toggleCrimeTimePanel);
            
            // Add new listener
            collapseBtn.addEventListener('click', toggleCrimeTimePanel);
        } else {
            console.error('Could not find collapse button in immediate init');
            // Since the button might not exist yet, set up a small delay
            setTimeout(function() {
                const delayedBtn = document.getElementById('crime-time-collapse');
                if (delayedBtn) {
                    console.log('Found collapse button after delay');
                    delayedBtn.addEventListener('click', toggleCrimeTimePanel);
                } else {
                    console.error('Still could not find collapse button after delay');
                }
            }, 500);
        }
        
        // The toggle function
        function toggleCrimeTimePanel(e) {
            console.log('Toggle crime time panel function called');
            const panel = document.getElementById('crime-time-panel');
            if (panel) {
                console.log('Current panel class:', panel.className);
                
                // Simple toggle - just collapse/expand the content
                // We're not hiding the panel completely anymore to avoid button issues
                panel.classList.toggle('collapsed');
                
                console.log('New panel class:', panel.className);
            } else {
                console.error('Could not find crime-time-panel');
            }
            
            // Prevent default and stop propagation
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
        
        // Also add a global function for debugging from console
        window.toggleCrimePanel = toggleCrimeTimePanel;
        console.log('Added global toggleCrimePanel function for debugging');
    })();

}); // End of document.addEventListener('DOMContentLoaded') 