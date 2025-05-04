// Crime Type Analysis Panel functionality

// Function to update the crime type panel
function updateCrimeTypePanel(crimeData) {
    console.log("🔍 CRIME TYPE PANEL - Updating with data:", crimeData);
    
    const crimeTypePanel = document.getElementById('crime-type-panel');
    if (!crimeTypePanel) {
        console.error("Crime type panel not found");
        return;
    }
    
    // Ensure panel is visible regardless of data
    crimeTypePanel.style.display = 'block';
    
    // Set default types if missing
    if (!crimeData) {
        console.log("🔍 CRIME TYPE PANEL - No crime data provided, creating empty object");
        crimeData = { count: 0, types: {} };
    }
    
    // If no types property, create it
    if (!crimeData.types) {
        console.log("🔍 CRIME TYPE PANEL - No types property, creating empty object");
        crimeData.types = {};
    }
    
    // AGGRESSIVE DATA COLLECTION - Try multiple sources to get crime data
    
    // 1. If we have filtered crime data from global objects, try to build types from it
    if (window._filteredCrimeData && window._filteredCrimeData.features && 
        Object.keys(crimeData.types).length === 0) {
        
        console.log("🔍 CRIME TYPE PANEL - Building crime types from _filteredCrimeData");
        const types = {};
        
        // Process features to extract types
        window._filteredCrimeData.features.forEach(feature => {
            if (feature && feature.properties) {
                const props = feature.properties;
                
                // Log the actual properties to see what we're working with
                console.log("🔍 CRIME TYPE PANEL - Crime data properties:", props);
                
                // Extract bcsrgrp (category) as primary identifier, then bcsrcat (type) as fallback
                let crimeType = props.bcsrgrp; // Primary: use category (bcsrgrp)
                
                // If category is undefined/null/empty, try using type (bcsrcat)
                if (!crimeType || crimeType === 'undefined') {
                    crimeType = props.bcsrcat; 
                }
                
                // If still not defined, try other possible property names
                if (!crimeType || crimeType === 'undefined') {
                    crimeType = props.event_type || props.type || props.crime_type;
                }
                
                // Last resort fallback
                if (!crimeType || crimeType === 'undefined') {
                    crimeType = 'Unknown';
                }
                
                // Skip "undefined" entries
                if (crimeType && crimeType !== 'undefined') {
                    if (!types[crimeType]) {
                        types[crimeType] = 1;
                    } else {
                        types[crimeType]++;
                    }
                }
            }
        });
        
        console.log("🔍 CRIME TYPE PANEL - Types extracted from _filteredCrimeData:", types);
        
        // Update crimeData with the types we found
        crimeData.types = types;
        
        // Also update count if needed
        if (!crimeData.count || crimeData.count === 0) {
            if (window.CURRENT_FILTERED_CRIME_COUNT !== undefined) {
                crimeData.count = window.CURRENT_FILTERED_CRIME_COUNT;
            } else if (window.AI_SAFETY_CRIME_COUNT !== undefined) {
                crimeData.count = window.AI_SAFETY_CRIME_COUNT;
            } else {
                crimeData.count = window._filteredCrimeData.features.length;
            }
            console.log(`🔍 CRIME TYPE PANEL - Updated crime count to ${crimeData.count} from available sources`);
        }
    }
    
    // 2. Try to get data directly from the map source
    if (Object.keys(crimeData.types).length === 0 && window.map && window.map.getSource) {
        try {
            const source = window.map.getSource('crime-data');
            if (source && source._data && source._data.features) {
                console.log("🔍 CRIME TYPE PANEL - Getting crime data directly from map source");
                
                const types = {};
                let count = 0;
                
                // Filter out clusters
                const features = source._data.features.filter(f => !f.properties.cluster);
                
                features.forEach(feature => {
                    if (feature && feature.properties) {
                        const props = feature.properties;
                        
                        // Log properties for debugging
                        console.log("🔍 CRIME TYPE PANEL - Map source crime properties:", props);
                        
                        // Extract bcsrgrp (category) as primary identifier, then bcsrcat (type) as fallback
                        let crimeType = props.bcsrgrp; // Primary: use category (bcsrgrp)
                        
                        // If category is undefined/null/empty, try using type (bcsrcat)
                        if (!crimeType || crimeType === 'undefined') {
                            crimeType = props.bcsrcat; 
                        }
                        
                        // If still not defined, try other possible property names
                        if (!crimeType || crimeType === 'undefined') {
                            crimeType = props.event_type || props.type || props.crime_type;
                        }
                        
                        // Last resort fallback
                        if (!crimeType || crimeType === 'undefined') {
                            crimeType = 'Unknown';
                        }
                        
                        // Skip "undefined" entries
                        if (crimeType && crimeType !== 'undefined') {
                            if (!types[crimeType]) {
                                types[crimeType] = 1;
                            } else {
                                types[crimeType]++;
                            }
                            count++;
                        }
                    }
                });
                
                console.log("🔍 CRIME TYPE PANEL - Types extracted from map source:", types);
                
                if (Object.keys(types).length > 0) {
                    crimeData.types = types;
                    crimeData.count = count;
                }
            }
        } catch (e) {
            console.error("🔍 CRIME TYPE PANEL - Error getting data from map source:", e);
        }
    }
    
    // 3. Last resort - generate fake data to verify the panel works
    if (Object.keys(crimeData.types).length === 0) {
        console.log("🔍 CRIME TYPE PANEL - No crime type data found");
        
        // Don't generate fake data, just leave types empty
        crimeData.count = 0;
    }
    
    // Check if we have crime types after all processing
    const hasTypes = crimeData.types && Object.keys(crimeData.types).length > 0;
    
    console.log("🔍 CRIME TYPE PANEL - Final data:", {
        hasTypes,
        count: crimeData.count,
        types: crimeData.types
    });
    
    // If no crime data or no types after all attempts, show a message
    if (!hasTypes || crimeData.count === 0) {
        document.getElementById('crime-type-advice').textContent = 'No crime types available for this route.';
        document.getElementById('total-type-incidents').textContent = '0';
        document.getElementById('top-crime-type').textContent = 'N/A';
        
        // Clear any existing chart
        if (window.crimeTypeChart) {
            window.crimeTypeChart.destroy();
            window.crimeTypeChart = null;
        }
        
        // Clear the canvas to remove any remnants
        const ctx = document.getElementById('crime-type-chart').getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        
        return;
    }
    
    // Update total incidents
    document.getElementById('total-type-incidents').textContent = crimeData.count || 0;
    
    // Process crime types for display
    const typeEntries = Object.entries(crimeData.types)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count); // Sort by count descending

    console.log("🔍 CRIME TYPE PANEL - Crime type entries for chart:", typeEntries);

    // Get the top crime type
    const topCrimeType = typeEntries.length > 0 ? typeEntries[0].type : 'Unknown';
    document.getElementById('top-crime-type').textContent = topCrimeType;
    
    // Create advice based on crime types
    let advice = '';
    if (typeEntries.length > 0) {
        advice = `Most common incident type: ${topCrimeType} (${typeEntries[0].count} incidents). `;
        if (typeEntries.length > 1) {
            advice += `Other significant types: ${typeEntries.slice(1, 3).map(entry => entry.type).join(', ')}.`;
        }
    } else {
        advice = 'No detailed crime type information available.';
    }
    document.getElementById('crime-type-advice').textContent = advice;
    
    // Create chart using Chart.js
    const ctx = document.getElementById('crime-type-chart').getContext('2d');
    
    // Destroy previous chart if it exists
    if (window.crimeTypeChart) {
        window.crimeTypeChart.destroy();
    }
    
    // Prepare data for chart - limit to top 5 types to avoid clutter (reduced from 6)
    const chartData = typeEntries.slice(0, 5);
    
    // Create a category for "Other" if there are more than 5 types (changed from 6)
    if (typeEntries.length > 5) {
        const otherCount = typeEntries.slice(5).reduce((sum, entry) => sum + entry.count, 0);
        chartData.push({ type: 'Other', count: otherCount });
    }
    
    // Verify data before creating the chart
    console.log("🔍 CRIME TYPE PANEL - Final chart data:", {
        labels: chartData.map(entry => entry.type),
        data: chartData.map(entry => entry.count)
    });
    
    // Check for any undefined or null values
    const hasUndefinedLabels = chartData.some(entry => !entry.type || entry.type === 'undefined');
    if (hasUndefinedLabels) {
        console.warn("🔍 CRIME TYPE PANEL - WARNING: Chart contains undefined labels!");
        
        // Replace any undefined with "Unknown"
        chartData.forEach(entry => {
            if (!entry.type || entry.type === 'undefined') {
                entry.type = 'Unknown';
            }
        });
    }
    
    // Create a pie chart for crime types
    window.crimeTypeChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: chartData.map(entry => entry.type || 'Unknown'),
            datasets: [{
                label: 'Crime Types',
                data: chartData.map(entry => entry.count),
                backgroundColor: [
                    'rgba(231, 76, 60, 0.8)',   // Red
                    'rgba(52, 152, 219, 0.8)',  // Blue
                    'rgba(46, 204, 113, 0.8)',  // Green
                    'rgba(155, 89, 182, 0.8)',  // Purple
                    'rgba(241, 196, 15, 0.8)',  // Yellow
                    'rgba(230, 126, 34, 0.8)',  // Orange
                    'rgba(149, 165, 166, 0.8)'  // Gray
                ],
                borderColor: 'rgba(255, 255, 255, 0.8)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations completely
            },
            layout: {
                padding: {
                    left: 0,
                    right: 5, // Add a bit of right padding for legend
                    top: 0,
                    bottom: 5 // Add a bit of bottom padding
                }
            },
            plugins: {
                legend: {
                    position: 'right',
                    align: 'start',
                    labels: {
                        color: '#333',
                        boxWidth: 8,  // Even smaller box (was 10)
                        padding: 3,   // Even smaller padding (was 5)
                        font: {
                            size: 8   // Even smaller font (was 10)
                        },
                        // Simplify legend rendering to ensure it works correctly
                        usePointStyle: false, // Use simple boxes
                        // Truncate text only if needed
                        formatter: function(value, legendItem, index) {
                            return value.length > 12 ? value.substring(0, 10) + '...' : value;
                        }
                    }
                },
                tooltip: {
                    enabled: chartData.length > 0, // Only enable tooltips if we have actual data
                    displayColors: false, // Remove color boxes in tooltip
                    backgroundColor: 'rgba(0, 0, 0, 0.7)', // Darker background for better contrast
                    titleFont: {
                        size: 10 // Smaller title font
                    },
                    bodyFont: {
                        size: 9 // Smaller body font
                    },
                    padding: 4, // Smaller padding
                    callbacks: {
                        title: function(context) {
                            // Keep title short
                            const title = context[0].label;
                            return title.length > 15 ? title.substring(0, 13) + '...' : title;
                        },
                        label: function(context) {
                            // Simplified shorter label
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(0);
                            return `${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Connect to AI Safety Assessment and other events
function connectToSafetyEvents() {
    console.log("🔍 CRIME TYPE PANEL - Connecting to safety events");
    
    // Track when the last update happened to prevent too frequent updates
    let lastUpdateTime = 0;
    const MIN_UPDATE_INTERVAL = 3000; // minimum 3 seconds between updates
    
    // Function to check if we should update based on time
    function shouldUpdate() {
        const now = Date.now();
        if (now - lastUpdateTime > MIN_UPDATE_INTERVAL) {
            lastUpdateTime = now;
            return true;
        }
        return false;
    }
    
    // 1. Listen for calculateSafetyScore calls
    if (window.calculateSafetyScore) {
        const originalSafetyScore = window.calculateSafetyScore;
        window.calculateSafetyScore = function(route) {
            console.log("🔍 CRIME TYPE PANEL - Safety score calculation detected");
            
            // Call original function and get result
            const result = originalSafetyScore.apply(this, arguments);
            
            // After a delay to let processing finish
            setTimeout(() => {
                if (shouldUpdate()) {
                    console.log("🔍 CRIME TYPE PANEL - Updating after safety calculation");
                    updateCrimeTypePanel({}); // Start fresh
                }
            }, 1000);
            
            return result;
        };
        console.log("🔍 CRIME TYPE PANEL - Hooked into calculateSafetyScore");
    }
    
    // 2. Listen for crimeMarkersUpdated event
    window.addEventListener('crimeMarkersUpdated', function(event) {
        console.log("🔍 CRIME TYPE PANEL - Crime markers updated event detected");
        setTimeout(() => {
            if (shouldUpdate()) {
                updateCrimeTypePanel({});
            }
        }, 500);
    });
    
    // 3. Watch for UI events that might indicate safety assessment
    const chatSendBtn = document.getElementById('chat-send-btn');
    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', function() {
            console.log("🔍 CRIME TYPE PANEL - Chat send button clicked, will check for safety request");
            const chatInput = document.getElementById('chat-input');
            if (chatInput && chatInput.value.toLowerCase().includes('safety')) {
                console.log("🔍 CRIME TYPE PANEL - Safety request detected in chat");
                setTimeout(() => {
                    if (shouldUpdate()) {
                        updateCrimeTypePanel({});
                    }
                }, 2000);
            }
        });
    }
    
    // 4. Use MutationObserver to watch for AI responses
    if (window.MutationObserver) {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            const observer = new MutationObserver(function(mutations) {
                for (const mutation of mutations) {
                    if (mutation.addedNodes && mutation.addedNodes.length) {
                        // Check if the added node is an assistant message
                        const node = mutation.addedNodes[0];
                        if (node.classList && node.classList.contains('message') && 
                            node.classList.contains('assistant')) {
                            console.log("🔍 CRIME TYPE PANEL - AI response detected, checking for safety content");
                            
                            // Wait a bit for any calculations to finish
                            setTimeout(() => {
                                if (shouldUpdate()) {
                                    updateCrimeTypePanel({});
                                }
                            }, 1500);
                        }
                    }
                }
            });
            
            observer.observe(chatMessages, { childList: true });
            console.log("🔍 CRIME TYPE PANEL - Set up observer for chat messages");
        }
    }
    
    // 5. Periodically check for crime data (last resort) - REDUCED FREQUENCY FROM 5000 to 10000
    setInterval(() => {
        // Only update if panel is visible
        const panel = document.getElementById('crime-type-panel');
        if (panel && panel.style.display === 'block' && !panel.classList.contains('collapsed')) {
            console.log("🔍 CRIME TYPE PANEL - Periodic check for crime data");
            if (shouldUpdate()) {
                updateCrimeTypePanel({});
            }
        }
    }, 10000); // Reduced from 5000 to 10000ms
}

// Initialize the crime type panel when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log("🔍 CRIME TYPE PANEL - DOM loaded, initializing");
    
    // Set up event listener for the crime type panel collapse button
    const collapseBtn = document.getElementById('crime-type-collapse');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', function(e) {
            const panel = document.getElementById('crime-type-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                
                // If expanding, update the panel
                if (!panel.classList.contains('collapsed')) {
                    updateCrimeTypePanel({});
                }
                
                // Update aria-expanded attribute for accessibility
                const isExpanded = !panel.classList.contains('collapsed');
                this.setAttribute('aria-expanded', isExpanded);
            }
            
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    // Set the panel to be collapsed by default
    const panel = document.getElementById('crime-type-panel');
    if (panel) {
        panel.classList.add('collapsed');
    }
    
    // Set specific dimensions for the chart container to prevent overflow
    const chartContainer = document.getElementById('crime-type-chart');
    if (chartContainer) {
        // Set fixed height to ensure it fits in the panel
        chartContainer.style.height = '160px';
        chartContainer.style.maxWidth = '100%';
        chartContainer.style.position = 'relative';
    }
    
    // Hook into the existing crime time panel updates
    // This will allow the crime type panel to update whenever the crime time panel updates
    const originalUpdateCrimeTimePanelWithData = window.updateCrimeTimePanelWithData;
    if (originalUpdateCrimeTimePanelWithData) {
        window.updateCrimeTimePanelWithData = function(crimeData) {
            // Call the original function
            originalUpdateCrimeTimePanelWithData(crimeData);
            
            // Also update the crime type panel
            console.log("🔍 CRIME TYPE PANEL - Crime time panel updated, updating crime type panel with same data");
            updateCrimeTypePanel(crimeData);
        };
        
        // Make the updateCrimeTypePanel function available globally
        window.updateCrimeTypePanel = updateCrimeTypePanel;
    }
    
    // Connect to safety events after a short delay to ensure everything is loaded
    setTimeout(connectToSafetyEvents, 1000);
    
    // Initial update to show something
    setTimeout(() => {
        console.log("🔍 CRIME TYPE PANEL - Initial update");
        updateCrimeTypePanel({});
    }, 2000);
}); 