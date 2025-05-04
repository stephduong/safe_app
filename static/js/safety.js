/**
 * Safety analysis module for evaluating route lighting based on street lamp data
 */

// Constants for safety analysis
const DEFAULT_LAMP_BUFFER = 25; // meters
const SAFE_LAMP_DENSITY = 1.5; // lamps per 100 meters is considered well-lit

// Make constants globally available
window.SAFE_LAMP_DENSITY = SAFE_LAMP_DENSITY;
window.DEFAULT_LAMP_BUFFER = DEFAULT_LAMP_BUFFER;

/**
 * Analyzes the lighting safety of a given route
 * @param {Array} route - Array of coordinates [{lat, lng}]
 * @returns {Object} Analysis results including lamp count, density, coverage percentage, and safety status
 */
window.analyzeRouteLighting = async function(route) {
    if (!route || !Array.isArray(route) || route.length < 2) {
        console.error("Invalid route data provided to analyzeRouteLighting:", route);
        throw new Error('Invalid route data');
    }
    
    console.log(`Starting route lighting analysis with ${route.length} points`);
    console.log("Route sample:", route.slice(0, 2));
    
    // Calculate route length
    const routeLength = calculateRouteLength(route);
    console.log(`Route length: ${routeLength.toFixed(2)} meters`);
    
    // Get bounding box for route to fetch street lamps
    const bbox = getBoundingBoxForRoute(route);
    console.log("Route bounding box:", bbox);
    
    // Ensure street lamp data is loaded
    let streetLamps = window.state?.streetLamps || window.streetLamps || [];
    console.log(`Initial street lamp count: ${streetLamps.length}`);
    
    // If no street lamps are loaded yet, try to fetch them
    if ((!streetLamps || streetLamps.length === 0) && window.fetchStreetLamps) {
        try {
            console.log('Fetching street lamps for safety analysis...');
            const bboxString = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
            streetLamps = await window.fetchStreetLamps(bboxString);
            console.log(`Fetched ${streetLamps.length} street lamps`);
            
            // Store for future use
            if (window.state) {
                window.state.streetLamps = streetLamps;
            }
        } catch (error) {
            console.error('Error fetching street lamp data:', error);
        }
    }
    
    console.log(`Using ${streetLamps.length} street lamps for analysis`);
    
    // Use the visible lamp count from window if available, otherwise calculate
    let lampsNearRoute = window.visibleLampCount || 0;
    
    // If no visible lamp count is available, calculate it
    if (!lampsNearRoute && window.countStreetLampsAlongRoute) {
        lampsNearRoute = window.countStreetLampsAlongRoute(route, streetLamps, DEFAULT_LAMP_BUFFER);
    }
    
    console.log(`Found ${lampsNearRoute} lamps within ${DEFAULT_LAMP_BUFFER}m of the route`);
    
    // Calculate lamp density (lamps per 100 meters)
    const lampDensity = routeLength > 0 ? (lampsNearRoute / routeLength) * 100 : 0;
    
    // Calculate route coverage (percentage of route segments that have at least one lamp nearby)
    let coveredSegments = 0;
    
    for (let i = 0; i < route.length - 1; i++) {
        const segmentStart = route[i];
        const segmentEnd = route[i+1];
        
        // Check if any lamp is near this segment
        const hasNearbyLamp = streetLamps.some(lamp => {
            // Calculate distances from lamp to segment start and end
            const distToStart = haversineDistance(
                lamp.geometry.coordinates[1], lamp.geometry.coordinates[0], 
                segmentStart.lat, segmentStart.lng
            );
            const distToEnd = haversineDistance(
                lamp.geometry.coordinates[1], lamp.geometry.coordinates[0], 
                segmentEnd.lat, segmentEnd.lng
            );
            
            // If either distance is within buffer, segment is covered
            return distToStart <= DEFAULT_LAMP_BUFFER || distToEnd <= DEFAULT_LAMP_BUFFER;
        });
        
        if (hasNearbyLamp) {
            coveredSegments++;
        }
    }
    
    const coveragePercentage = route.length > 1 
        ? (coveredSegments / (route.length - 1)) * 100 
        : 0;
    
    // Determine safety level
    let safetyLevel;
    if (lampDensity >= SAFE_LAMP_DENSITY && coveragePercentage >= 80) {
        safetyLevel = 'high';
    } else if (lampDensity >= SAFE_LAMP_DENSITY * 0.6 && coveragePercentage >= 60) {
        safetyLevel = 'medium';
    } else {
        safetyLevel = 'low';
    }
    
    // Update the streetlight progress bar with the coverage data
    updateStreetlightProgressBar(coveragePercentage, lampDensity, routeLength);
    
    return {
        routeLength: Math.round(routeLength),
        lampCount: lampsNearRoute,
        lampDensity: lampDensity.toFixed(2),
        coveragePercentage: coveragePercentage.toFixed(1),
        safetyLevel
    };
};

/**
 * Updates the streetlight coverage progress bar and related UI elements
 * @param {number} coveragePercentage - Percentage of route covered by streetlights
 * @param {number} lampDensity - Lamp density per 100 meters
 * @param {number} routeLength - Total route length in meters
 */
function updateStreetlightProgressBar(coveragePercentage, lampDensity, routeLength) {
    // Round values for display
    const roundedCoverage = Math.round(coveragePercentage);
    const roundedDensity = lampDensity.toFixed(1);
    
    // Get DOM elements
    const progressFill = document.getElementById('streetlight-progress-fill');
    const coverageText = document.getElementById('streetlight-coverage-percent');
    const densityValue = document.getElementById('lamp-density');
    const adviceElement = document.getElementById('streetlight-advice');
    
    // Update progress bar and text
    if (progressFill) {
        progressFill.style.width = `${roundedCoverage}%`;
    }
    
    if (coverageText) {
        coverageText.textContent = `${roundedCoverage}%`;
    }
    
    if (densityValue) {
        densityValue.textContent = roundedDensity;
    }
    
    // Generate advice text based on coverage and density
    if (adviceElement) {
        let adviceText = '';
        if (coveragePercentage >= 80 && lampDensity >= SAFE_LAMP_DENSITY) {
            adviceText = `Excellent lighting coverage (${roundedCoverage}%) with good lamp density (${roundedDensity} per 100m) along this ${(routeLength/1000).toFixed(1)}km route.`;
        } else if (coveragePercentage >= 60 && lampDensity >= SAFE_LAMP_DENSITY * 0.6) {
            adviceText = `Moderate lighting coverage (${roundedCoverage}%) with average lamp density (${roundedDensity} per 100m) along this ${(routeLength/1000).toFixed(1)}km route.`;
        } else {
            adviceText = `Low lighting coverage (${roundedCoverage}%) with insufficient lamp density (${roundedDensity} per 100m) along this ${(routeLength/1000).toFixed(1)}km route. Consider alternative routes if traveling at night.`;
        }
        adviceElement.textContent = adviceText;
    }
    
    // Show the streetlight panel by expanding it if it's collapsed
    const streetlightPanel = document.getElementById('streetlight-panel');
    if (streetlightPanel && streetlightPanel.classList.contains('collapsed')) {
        streetlightPanel.classList.remove('collapsed');
    }
}

/**
 * Generates a safety response based on lighting and crime data
 * @param {Object} analysisResult - Result of lighting analysis
 * @returns {String} A formatted response about route safety
 */
window.generateSafetyResponse = function(analysisResult) {
    const { status, litSegments, unlitSegments, totalSegments, percentageLit, safetyLevel, lampCount, lampDensity, routeLength, visibleMarkerCount, exactCrimeIncidents } = analysisResult;
    
    if (status !== 'success') {
        return "I'm unable to provide a safety analysis for this route at the moment. Please ensure you have a valid route plotted on the map and try again.";
    }
    
    // Check if we have a current route
    if (!window.mapState.routeGeometry || window.mapState.routeGeometry.length === 0) {
        return "Please plot a route on the map first so I can analyze its safety.";
    }
    
    // Initialize response variables
    let response = '';
    let lightingInfo = '';
    let crimeInfo = '';
    let lgaInfo = '';
    let recommendations = '';
    
    // ---------- CRIME ANALYSIS ----------
    
    // IMPORTANT: Get the ACTUAL visible marker count by checking DOM or window.visibleCrimeCount
    // This is the most reliable way to match exactly what the user sees
    let actualMarkerCount = 0;
    let crimeData = null;
    
    // First check if we have a count from window globals (set by other functions)
    if (typeof window.visibleCrimeCount === 'number') {
        actualMarkerCount = window.visibleCrimeCount;
        console.log("Using global visible crime count:", actualMarkerCount);
    } 
    // Next try the passed value
    else if (typeof visibleMarkerCount === 'number') {
        actualMarkerCount = visibleMarkerCount;
        console.log("Using passed visible marker count:", actualMarkerCount);
    } 
    // If we have an exact crime incidents object with a count
    else if (exactCrimeIncidents && typeof exactCrimeIncidents.count === 'number') {
        actualMarkerCount = exactCrimeIncidents.count;
        console.log("Using exact crime incidents count:", actualMarkerCount);
    }
    // Last resort - try to count markers in the DOM
    else {
        try {
            // Try to count actual markers in the DOM if possible
            if (typeof document !== 'undefined') {
                // Count actual marker elements on the map with more specific selectors to target only crime markers
                const markerElements = document.querySelectorAll('.crime-marker:not([style*="display: none"]), .marker-crime:not([style*="display: none"])');
                if (markerElements && markerElements.length > 0) {
                    actualMarkerCount = markerElements.length;
                    console.log("Counted actual crime marker DOM elements:", actualMarkerCount);
                    // Update the global count to keep everything in sync
                    window.visibleCrimeCount = actualMarkerCount;
                } else {
                    // If we couldn't find specific crime markers but have a filtered data set, use that count
                    if (window._filteredCrimeData && window._filteredCrimeData.features) {
                        actualMarkerCount = window._filteredCrimeData.features.length;
                        console.log("Using filtered crime data feature count:", actualMarkerCount);
                        window.visibleCrimeCount = actualMarkerCount;
                    }
                }
            }
        } catch (e) {
            console.error("Error counting markers:", e);
        }
    }
    
    // Final verification - try DOM count one more time if we got zero but crime should be visible
    if (actualMarkerCount === 0 && window.crimeMarkersVisible) {
        try {
            // Do one final check of the DOM
            const visibleMarkers = document.querySelectorAll('.mapboxgl-marker:not([style*="display: none"])');
            if (visibleMarkers && visibleMarkers.length > 0) {
                console.log(`Final verification found ${visibleMarkers.length} visible markers in DOM`);
                actualMarkerCount = visibleMarkers.length;
                window.visibleCrimeCount = actualMarkerCount;
            }
        } catch (e) {
            console.error("Error in final marker verification:", e);
        }
    }
    
    // Create a basic crime data object using the actual marker count
    crimeData = {
        count: actualMarkerCount,
        incidents: [],
        types: { "Unknown": actualMarkerCount },
        timeCategories: { "Unknown": actualMarkerCount },
        recentIncidents: 0,
        mostCommonTime: 'Unknown',
        mostCommonType: 'Unknown',
        hotspotSegment: -1
    };
    
    // If we have detailed data available, use it instead
    if (exactCrimeIncidents && exactCrimeIncidents.incidents) {
        crimeData = exactCrimeIncidents;
        // But keep the actual count
        crimeData.count = actualMarkerCount;
    }
    
    // Add a global for other functions to access
    window.lastReportedCrimeCount = actualMarkerCount;
    
    // Generate the crime info text
    if (crimeData.count > 0) {
        // Format crime information
        const recentPercentage = crimeData.recentIncidents > 0 
            ? Math.round((crimeData.recentIncidents / crimeData.count) * 100) 
            : 0;
        
        // Clear statement about what the user is seeing
        crimeInfo = `I've identified ${actualMarkerCount} crime incidents in the area.`;
        
        // Add information about crime types
        if (crimeData.mostCommonType !== 'Unknown') {
            crimeInfo += ` The most common type of incident is ${crimeData.mostCommonType}.`;
        }
        
        // Add time pattern information
        if (crimeData.mostCommonTime !== 'Unknown') {
            crimeInfo += ` Most incidents occurred during ${crimeData.mostCommonTime}.`;
        }
        
        // List most concerning incidents (exactly 3, or fewer if not available)
        if (crimeData.incidents && crimeData.incidents.length > 0) {
            // First deduplicate incidents - create a unique fingerprint for each incident
            const uniqueIncidents = [];
            const seenFingerprints = new Set();
            
            for (const incident of crimeData.incidents) {
                // Create a fingerprint based on type, date, time, and location
                const fingerprint = `${incident.type}|${incident.date}|${incident.time}|${incident.description || incident.location || ''}|${incident.distance}`;
                
                if (!seenFingerprints.has(fingerprint)) {
                    seenFingerprints.add(fingerprint);
                    uniqueIncidents.push(incident);
                }
            }
            
            console.log(`Deduplicated ${crimeData.incidents.length} incidents to ${uniqueIncidents.length} unique incidents`);
            
            // Sort the unique incidents by recency and proximity
            const sortedIncidents = uniqueIncidents.sort((a, b) => {
                // Prioritize recent incidents
                if (a.isRecent && !b.isRecent) return -1;
                if (!a.isRecent && b.isRecent) return 1;
                
                // Then sort by date (newest first) if available
                if (a.date && b.date) {
                    try {
                        const dateA = new Date(a.date);
                        const dateB = new Date(b.date);
                        if (!isNaN(dateA) && !isNaN(dateB)) {
                            return dateB - dateA;
                        }
                    } catch (e) {
                        // Fall back to distance if date parsing fails
                    }
                }
                
                // Then sort by distance
                if (a.distance !== b.distance) {
                return a.distance - b.distance;
                }
                
                // If everything else is the same, use type as final tiebreaker
                return (a.type || '').localeCompare(b.type || '');
            });
            
            // Take exactly 3 most recent/relevant incidents (or fewer if not available)
            const notableIncidents = sortedIncidents.slice(0, Math.min(3, sortedIncidents.length));
            
            if (notableIncidents.length > 0) {
                crimeInfo += "\n\nMost recent crime incidents on your route:";
                
                notableIncidents.forEach((incident, index) => {
                    // Get all available properties from the incident
                    const properties = incident.properties || {};
                    
                    // Create a more detailed incident description
                    let incidentDesc = `\n- INCIDENT ${index + 1}: `;
                    
                    // Add incident type
                    const incidentType = incident.type || properties.bcsrcat || properties.offence_type || "Unknown";
                    incidentDesc += incidentType;
                    
                    // Add date information
                    let dateInfo = "Date unknown";
                    if (incident.date) {
                                    dateInfo = incident.date;
                    } else if (properties.incday && properties.incmonth && properties.incyear) {
                        dateInfo = `${properties.incday}, ${properties.incmonth} ${properties.incyear}`;
                    } else if (properties.incmonth && properties.incyear) {
                        dateInfo = `${properties.incmonth} ${properties.incyear}`;
                    }
                    incidentDesc += ` on ${dateInfo}`;
                    
                    // Add time information
                    let timeInfo = "time unknown";
                    if (incident.time) {
                        timeInfo = incident.time;
                    } else if (properties.incsttm) {
                        timeInfo = properties.incsttm;
                    }
                    incidentDesc += ` at ${timeInfo}`;
                    
                    // Add location information
                    let locationInfo = "Unknown location";
                    if (incident.description) {
                        locationInfo = incident.description;
                    } else if (incident.location) {
                        locationInfo = incident.location;
                    } else if (properties.locsurb) {
                        locationInfo = properties.locsurb;
                        if (properties.locprmc1) {
                            locationInfo += ` (${properties.locprmc1})`;
                        }
                    }
                    incidentDesc += `. Location: ${locationInfo}`;
                    
                    // Add distance information with more precision for differentiation
                    incidentDesc += `. Distance: ${Math.round(incident.distance)} meters from route`;
                    
                    // Include coordinates for debugging/traceability
                    if (incident.coordinates) {
                        const coords = incident.coordinates;
                        // Truncate to 6 decimal places for readability
                        const lat = typeof coords[1] === 'number' ? coords[1].toFixed(6) : 'unknown';
                        const lng = typeof coords[0] === 'number' ? coords[0].toFixed(6) : 'unknown';
                        incidentDesc += ` [${lat}, ${lng}]`;
                    }
                    
                    // Add perpetrator information if available
                    let perpetratorInfo = "";
                    if (properties.poisex || properties.poi_age) {
                        perpetratorInfo += ". Perpetrator:";
                        if (properties.poisex) {
                            if (properties.poisex === 'M') {
                                perpetratorInfo += " Male";
                            } else if (properties.poisex === 'F') {
                                perpetratorInfo += " Female";
                                } else {
                                perpetratorInfo += ` ${properties.poisex}`;
                            }
                        }
                        
                        if (properties.poi_age) {
                            const age = parseFloat(properties.poi_age);
                            if (!isNaN(age) && age > 0) {
                                perpetratorInfo += `, age ${Math.round(age)}`;
                            }
                        }
                    }
                    incidentDesc += perpetratorInfo;
                    
                    // Add any additional info that might be helpful
                    if (incident.additionalInfo) {
                        const info = incident.additionalInfo;
                        if (info.status && info.status !== '') {
                            incidentDesc += `. Status: ${info.status}`;
                        }
                    }
                    
                    crimeInfo += incidentDesc;
                });
            }
        }
    } else {
        crimeInfo = "I found no reported crime incidents along your route.";
        
        // Still try to get LGA information even if no incidents on the route
        // Similar code as above for LGA lookup...
    }
    
    // Calculate the route lighting information
    const roundedPercentageLit = Math.round(percentageLit);
    
    // Get the actual lamp count that's being displayed on the map
    const actualLampCount = lampCount || window.visibleLampCount || 0;
    
    // Generate lighting assessment with specific numbers about street lamps
    lightingInfo = `Your route has ${actualLampCount} street lamps. `;
    
    if (roundedPercentageLit >= 80) {
        lightingInfo += `This route is well-lit with approximately ${roundedPercentageLit}% of the path having street lighting.`;
    } else if (roundedPercentageLit >= 50) {
        lightingInfo += `This route is moderately lit with approximately ${roundedPercentageLit}% of the path having street lighting.`;
    } else {
        lightingInfo += `This route is poorly lit with only approximately ${roundedPercentageLit}% of the path having street lighting.`;
    }
    
    // Add detailed lighting density information
    lightingInfo += ` The lamp density is ${lampDensity} lamps per 100 meters along your ${routeLength}-meter route.`;
    
    if (litSegments && unlitSegments) {
        lightingInfo += ` Specifically, ${litSegments} segments of your route are well-lit, while ${unlitSegments} segments lack adequate lighting.`;
    }
    
    // Generate safety recommendations
    recommendations = "\n\nSafety recommendations:";
    
    // Lighting recommendations
    if (roundedPercentageLit < 50) {
        recommendations += "\n- Bring a flashlight or use your phone's flashlight in poorly lit areas";
        recommendations += "\n- Consider traveling with a companion during nighttime";
    }
    
    // Crime-based recommendations
    if (crimeData && crimeData.count > 0) {
        if (crimeData.count > 10) {
            recommendations += "\n- Exercise heightened awareness throughout this route";
            recommendations += "\n- Consider alternative routes, especially during nighttime";
        }
        
        if (crimeData.mostCommonTime === 'Night (10pm-6am)' || crimeData.mostCommonTime === 'Evening (6pm-10pm)') {
            recommendations += "\n- Travel during daylight hours along this route if possible";
        }
        
        if (crimeData.hotspotSegment >= 0) {
            recommendations += "\n- Be particularly cautious in areas with higher concentrations of past incidents";
        }
        
        recommendations += "\n- Keep valuables out of sight and maintain awareness of your surroundings";
    }
    
    // Build the final response
    response = "I've analyzed your route for safety, examining both crime data and street lighting.\n\n";
    response += "🔒 CRIME ASSESSMENT:\n" + crimeInfo;
    
    // Add LGA info if available
    if (lgaInfo) {
        response += lgaInfo;
    }
    
    response += "\n\n🔆 LIGHTING ASSESSMENT: " + lightingInfo;

    // Add a new comprehensive safety summary section here
    let safetySummary = "\n\n📊 SAFETY SUMMARY:\n";

    // Determine overall safety level based on both crime and lighting data
    let overallSafetyLevel = "moderate";
    let walkingTimeDesc = "";
    let specificConcerns = [];

    // Assess time of day risk factors
    if (crimeData && crimeData.mostCommonTime) {
        if (crimeData.mostCommonTime === 'Night (10pm-6am)') {
            walkingTimeDesc = "This route poses higher risks at night";
            specificConcerns.push("higher nighttime crime rates");
        } else if (crimeData.mostCommonTime === 'Evening (6pm-10pm)') {
            walkingTimeDesc = "This route poses moderate risks during evening hours";
            specificConcerns.push("evening crime incidents");
        } else {
            walkingTimeDesc = "This route is generally safer during daylight hours";
        }
    } else {
        walkingTimeDesc = "Based on available data, use extra caution at night";
    }

    // Assess lighting concerns
    if (roundedPercentageLit < 40) {
        specificConcerns.push("poor street lighting");
        if (!walkingTimeDesc.includes("night")) {
            walkingTimeDesc += " but has significant lighting concerns after dark";
        }
    } else if (roundedPercentageLit < 70) {
        specificConcerns.push("inconsistent street lighting");
    }

    // Assess crime density
    if (crimeData && crimeData.count > 0) {
        const routeLengthKm = routeLength / 1000;
        const crimePerKm = crimeData.count / routeLengthKm;
        
        if (crimePerKm > 10) {
            overallSafetyLevel = "low";
            specificConcerns.push("high concentration of crime incidents");
        } else if (crimePerKm > 5) {
            overallSafetyLevel = "moderate";
            specificConcerns.push("moderate concentration of crime incidents");
        }
        
        // Check hotspots
        if (crimeData.hotspotSegment >= 0) {
            specificConcerns.push("area hotspots with multiple incidents");
        }
    }

    // Check if night safety is severely compromised
    if (roundedPercentageLit < 40 && crimeData && crimeData.mostCommonTime === 'Night (10pm-6am)') {
        overallSafetyLevel = "low";
    }

    // Determine best times to travel
    let bestTimeToTravel = "";
    if (overallSafetyLevel === "low") {
        bestTimeToTravel = "This route is best traveled during daylight hours with companions.";
    } else if (overallSafetyLevel === "moderate") {
        bestTimeToTravel = "This route is best traveled during daylight hours, but can be used with caution in the evening with proper awareness.";
        } else {
        bestTimeToTravel = "This route appears generally safe at most times, but standard safety precautions are still advised.";
    }

    // Comparison to alternative routes
    let alternativeRouteAdvice = "";
    if (specificConcerns.length >= 2) {
        alternativeRouteAdvice = "Consider exploring alternative routes if traveling at night or alone.";
    } else if (specificConcerns.length === 1) {
        alternativeRouteAdvice = "This route is acceptable but be mindful of the " + specificConcerns[0] + ".";
    } else {
        alternativeRouteAdvice = "This route appears to be a reasonable choice based on available safety data.";
    }

    // Build the safety summary
    safetySummary += `This route has a ${overallSafetyLevel.toUpperCase()} safety rating. ${walkingTimeDesc}. `;

    // Add specific concerns if any
    if (specificConcerns.length > 0) {
        safetySummary += `Main safety concerns include ${specificConcerns.join(", ")}. `;
    }

    // Add more specific crime timing information
    if (crimeData && crimeData.count > 0) {
        // Add time pattern details
        const timeCategories = crimeData.timeCategories || {};
        const timeEntries = Object.entries(timeCategories)
            .filter(([time, count]) => time !== 'Unknown' && count > 0)
            .sort((a, b) => b[1] - a[1]);
        
        if (timeEntries.length > 0) {
            const [mostCommonTime, mostCommonCount] = timeEntries[0];
            const totalKnownTimes = timeEntries.reduce((sum, [_, count]) => sum + count, 0);
            const percentage = Math.round((mostCommonCount / totalKnownTimes) * 100);
            
            if (percentage > 30) {
                safetySummary += `Based on historical data, approximately ${percentage}% of incidents in this area occurred during ${mostCommonTime}. `;
            }
            
            // Add secondary time info if significant
            if (timeEntries.length > 1) {
                const [secondTime, secondCount] = timeEntries[1];
                const secondPercentage = Math.round((secondCount / totalKnownTimes) * 100);
                
                if (secondPercentage > 20) {
                    safetySummary += `Another ${secondPercentage}% occurred during ${secondTime}. `;
                }
            }
        }
        
        // Add hotspot information if available
        if (crimeData.hotspotSegment >= 0 && crimeData.maxSegmentCount > 1) {
            // Try to describe the location of the hotspot more precisely
            let hotspotDescription = "a segment of the route";
            
            // If we have route info, try to describe the hotspot location relative to the start/end
            if (route && route.length > 0) {
                const routeSegments = route.length - 1;
                const hotspotPosition = crimeData.hotspotSegment / routeSegments;
                
                if (hotspotPosition < 0.25) {
                    hotspotDescription = "the beginning portion of the route";
                } else if (hotspotPosition < 0.4) {
                    hotspotDescription = "the first third of the route";
                } else if (hotspotPosition < 0.6) {
                    hotspotDescription = "the middle section of the route";
                } else if (hotspotPosition < 0.75) {
                    hotspotDescription = "the final third of the route";
                } else {
                    hotspotDescription = "the end portion of the route";
                }
            }
            
            safetySummary += `A crime hotspot was identified around ${hotspotDescription} with ${crimeData.maxSegmentCount} incidents concentrated in this area. `;
            
            // Add timing for this hotspot if we have detailed incident data
            if (crimeData.incidents && crimeData.incidents.length > 0) {
                // Filter incidents by segment
                const hotspotIncidents = crimeData.incidents.filter(inc => inc.segment === crimeData.hotspotSegment);
                const hotspotTimes = hotspotIncidents
                    .map(inc => inc.time)
                    .filter(time => time && time !== 'Unknown');
                    
                // Check for night incidents in hotspot
                const nightTimeHotspotIncidents = hotspotTimes.filter(time => 
                    time.includes('Night') || 
                    time.includes('Evening') || 
                    (time.includes(':') && parseInt(time.split(':')[0]) >= 19 || parseInt(time.split(':')[0]) <= 5)
                );
                
                if (nightTimeHotspotIncidents.length > 0 && nightTimeHotspotIncidents.length / hotspotTimes.length > 0.5) {
                    safetySummary += `Most incidents in this hotspot occurred during evening or nighttime hours. `;
                }
            }
        }
    }

    // Add time and alternative route advice
    safetySummary += `${bestTimeToTravel} ${alternativeRouteAdvice}`;

    // Add contextual information about the areas
    if (crimeData && crimeData.types && Object.keys(crimeData.types).length > 0) {
        const topCrimeTypes = Object.entries(crimeData.types)
            .filter(([type, _]) => type.toLowerCase() !== "unknown")
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([type, _]) => type.toLowerCase());
            
        if (topCrimeTypes.length > 0) {
            safetySummary += ` Be particularly aware of ${topCrimeTypes.join(" and ")} in this area.`;
        }
    }

    // Add the safety summary to the response
    response += safetySummary;

    // Continue with the recommendations section
    response += recommendations;

    // Add final safety rating
    let safetyRating = "";
    if (overallSafetyLevel === "low") {
        safetyRating = "⚠️ EXERCISE CAUTION: This route has significant safety concerns that require heightened awareness.";
    } else if (overallSafetyLevel === "moderate") {
        safetyRating = "⚠️ USE CAUTION: This route has moderate safety concerns that require standard precautions.";
    } else {
        safetyRating = "✅ GENERALLY SAFE: This route appears relatively safe, but remain aware of your surroundings as usual.";
    }
    
    response += "\n\n" + safetyRating;
    
    return response;
};

/**
 * Checks if a user's message is a query about safety or lighting
 * @param {String} message - The user's message text
 * @returns {Boolean} True if the message is asking about safety or lighting
 */
window.isSafetyQuery = function(message) {
    if (!message || typeof message !== 'string') return false;
    
    const lowerMessage = message.toLowerCase();
    
    // Check if fuzzyMatch function is available
    const fuzzyMatchFn = window.fuzzyMatch || (typeof fuzzyMatch === 'function' ? fuzzyMatch : null);
    
    // Helper function that uses fuzzyMatch if available, otherwise falls back to includes
    const matchesKeyword = (text, keyword) => {
        if (fuzzyMatchFn) {
            return fuzzyMatchFn(text, keyword);
        }
        return text.includes(keyword);
    };
    
    // First, check if this is an LGA crime stats query - if so, it's NOT a safety query
    // This needs to match our isLgaCrimeStatsQuery logic in chat.js
    const lgaKeywords = ['lga', 'local government', 'area', 'suburb', 'region', 'city', 'town'];
    const crimeKeywords = ['crime', 'robbery', 'robberies', 'assault', 'theft', 'break', 
                         'steal', 'homicide', 'murder', 'violence', 'offence', 'offense'];
    
    const hasLgaKeyword = lgaKeywords.some(keyword => matchesKeyword(lowerMessage, keyword));
    const hasCrimeKeyword = crimeKeywords.some(keyword => matchesKeyword(lowerMessage, keyword));
    
    // Check if this appears to be an LGA crime query
    const mentionsRoute = routeKeywordsMatch(lowerMessage);
    const looksLikeLgaQuery = (hasLgaKeyword && hasCrimeKeyword) || 
                              (hasCrimeKeyword && !mentionsRoute);
    
    // If it seems like an LGA query, don't treat it as a safety query
    if (looksLikeLgaQuery) {
        console.log("Message appears to be an LGA crime query, not a route safety query");
        return false;
    }
    
    // Enhanced streetlight and lighting keywords to improve detection
    const lightingKeywords = [
        'light', 'lighting', 'lit', 'well lit', 'well-lit', 'dark',
        'streetlight', 'street light', 'street lamp', 'lamps', 'lantern', 
        'illumination', 'illuminate', 'brightness', 'lumens', 'visibility',
        'darkness', 'unlit', 'poorly lit', 'dimly lit', 'lamp density',
        'lamp coverage', 'street lighting', 'streetlight coverage'
    ];
    
    // Safety keywords
    const safetyKeywords = [
        'safe', 'safety', 'danger', 'dangerous', 'night', 'evening', 
        'secure', 'visibility', 'protection', 'risk'
    ];
    
    // Check for common safety question patterns
    const questionPatterns = ['?', 'how', 'is', 'are', 'what', 'where', 'when'];
    const isQuestion = questionPatterns.some(pattern => matchesKeyword(lowerMessage, pattern));
    
    // Helper function for route keyword matching
    function routeKeywordsMatch(text) {
        const routeKeywords = ['route', 'path', 'way', 'road', 'street', 'walk', 'walking', 'travel', 'journey'];
        return routeKeywords.some(keyword => matchesKeyword(text, keyword));
    }
    
    // Check for lighting-specific keywords that strongly indicate a lighting query
    const hasLightingKeyword = lightingKeywords.some(keyword => 
        matchesKeyword(lowerMessage, keyword)
    );
    
    // Check for safety keywords
    const hasSafetyKeyword = safetyKeywords.some(keyword => 
        matchesKeyword(lowerMessage, keyword)
    );
    
    // Special case for streetlight specific queries - prioritize these even if they don't follow
    // the typical question pattern
    const streetlightSpecificKeywords = ['streetlight', 'street light', 'lamp', 'light cover'];
    const isStreetlightSpecificQuery = streetlightSpecificKeywords.some(keyword => 
        matchesKeyword(lowerMessage, keyword)
    );
        
    // If it's specifically about streetlights, return true regardless of if it's a question
    if (isStreetlightSpecificQuery && mentionsRoute) {
        console.log("Detected specific streetlight query");
        return true;
    }
    
    // Special safety phrases that should always be detected
    const safetyPhrases = ['how safe', 'how well lit', 'street lamp'];
    const hasSafetyPhrase = safetyPhrases.some(phrase => matchesKeyword(lowerMessage, phrase));
    
    // Determine if this is likely a safety query
    return (isQuestion && mentionsRoute && (hasLightingKeyword || hasSafetyKeyword)) || 
           (hasSafetyPhrase && mentionsRoute);
};

/**
 * Calculates the length of a route in meters
 * @param {Array} route - Array of coordinates [{lat, lng}]
 * @returns {Number} Route length in meters
 */
function calculateRouteLength(route) {
    let length = 0;
    
    for (let i = 0; i < route.length - 1; i++) {
        const start = route[i];
        const end = route[i+1];
        
        length += haversineDistance(start.lat, start.lng, end.lat, end.lng);
    }
    
    return length;
}

/**
 * Calculates the haversine distance between two points in meters
 * @param {Number} lat1 - Latitude of point 1
 * @param {Number} lon1 - Longitude of point 1
 * @param {Number} lat2 - Latitude of point 2
 * @param {Number} lon2 - Longitude of point 2
 * @returns {Number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Returns a bounding box that encompasses the entire route
 * @param {Array} route - Array of coordinates [{lat, lng}]
 * @returns {Object} Bounding box with min/max lat/lng
 */
function getBoundingBoxForRoute(route) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    
    route.forEach(point => {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLng = Math.min(minLng, point.lng);
        maxLng = Math.max(maxLng, point.lng);
    });
    
    // Add a small buffer around the route (0.01 degrees ~ 1km)
    const buffer = 0.01;
    
    return {
        south: minLat - buffer,
        west: minLng - buffer,
        north: maxLat + buffer,
        east: maxLng + buffer
    };
}

/**
 * Counts crime incidents within a specified distance of a route
 * @param {Array} route - Array of coordinates representing the route
 * @param {Number} bufferDistance - Distance in meters to search around the route
 * @returns {Object} Statistics about crime incidents near the route
 */
window.countCrimeIncidentsAlongRoute = function(route, bufferDistance = 25) {
    console.log("Counting crime incidents along route with buffer:", bufferDistance);
    
    const actualBufferDistance = bufferDistance; // Using the specified buffer distance for counting
    
    if (!window.map || !window.map.getSource('crime-data') || !route || route.length === 0) {
        console.warn("Cannot count crime incidents: map, source, or route is missing");
        return { count: 0 };
    }
    
    try {
        // Get crime data from source
        const source = window.map.getSource('crime-data');
        const crimeData = source._data;
        
        if (!crimeData || !crimeData.features || crimeData.features.length === 0) {
            console.warn("No crime data available");
            return { count: 0 };
        }
        
        console.log(`Found ${crimeData.features.length} crime features in source`);
        
        // Prepare the result object
        const result = {
            count: 0,
            incidents: [],
            types: {},
            timeCategories: {
                'Morning (6am-12pm)': 0,
                'Afternoon (12pm-6pm)': 0,
                'Evening (6pm-10pm)': 0,
                'Night (10pm-6am)': 0,
                'Unknown': 0
            },
            recentIncidents: 0,
            mostCommonTime: 'Unknown',
            mostCommonType: 'Unknown',
            hottestSegment: -1,
            maxSegmentCount: 0
        };
        
        // For segment analysis
        let routeSegments = [];
        if (route.length > 1) {
            // Divide route into segments for analysis
            for (let i = 0; i < route.length - 1; i++) {
                routeSegments.push({
                    start: route[i],
                    end: route[i + 1],
                    incidentCount: 0
                });
            }
        }
        
        // Process crime data
        const processedFeatureIds = new Set(); // Track processed features to avoid duplicates
        
        for (const feature of crimeData.features) {
            if (!feature.geometry || !feature.geometry.coordinates) continue;
            
            // Skip if we've already processed this feature
            const featureId = feature.id || (feature.properties && feature.properties.id);
            const featureFingerprint = featureId || 
                JSON.stringify(feature.geometry.coordinates) + 
                JSON.stringify(feature.properties ? 
                    { type: feature.properties.category || feature.properties.crime_type, 
                      date: feature.properties.date || feature.properties.month,
                      time: feature.properties.time } : {});
            
            if (processedFeatureIds.has(featureFingerprint)) {
                console.log("Skipping duplicate feature:", featureFingerprint);
                continue;
            }
            
            processedFeatureIds.add(featureFingerprint);
            
            // Get crime coordinates
            const crimeCoords = feature.geometry.coordinates;
            
            // Find closest distance to the route
            let minDistance = Infinity;
            let closestSegment = -1;
            
            for (let i = 0; i < route.length - 1; i++) {
                const distance = window.distanceToLine(
                    crimeCoords,
                    route[i],
                    route[i + 1]
                );
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestSegment = i;
                }
            }
            
            // If crime is within buffer distance
            if (minDistance <= actualBufferDistance) {
                // Increment total count
                result.count++;
                
                // Extract properties for detailed information
                const properties = feature.properties || {};
                
                // Parse crime type
                const crimeType = properties.category || properties.crime_type || 'Unknown';
                result.types[crimeType] = (result.types[crimeType] || 0) + 1;
                
                // Parse crime date
                let crimeDate = null;
                let isRecent = false;
                
                if (properties.date || properties.month) {
                    crimeDate = properties.date || properties.month;
                    
                    // Check if incident is recent (within 30 days)
                    try {
                        const incidentDate = new Date(crimeDate);
                        const today = new Date();
                        const daysDiff = Math.floor((today - incidentDate) / (1000 * 60 * 60 * 24));
                        
                        if (daysDiff <= 30) {
                            result.recentIncidents++;
                            isRecent = true;
                        }
                    } catch (e) {
                        console.warn("Could not parse date:", crimeDate);
                    }
                }
                
                // Parse crime time
                let crimeTime = 'Unknown';
                
                if (properties.time) {
                    crimeTime = properties.time;
                    
                    // Categorize time
                    let timeCategory = 'Unknown';
                    try {
                        if (crimeTime.includes(':')) {
                            const timeParts = crimeTime.split(':');
                            const hour = parseInt(timeParts[0], 10);
                            
                            if (hour >= 6 && hour < 12) {
                                timeCategory = 'Morning (6am-12pm)';
                            } else if (hour >= 12 && hour < 18) {
                                timeCategory = 'Afternoon (12pm-6pm)';
                            } else if (hour >= 18 && hour < 22) {
                                timeCategory = 'Evening (6pm-10pm)';
                            } else {
                                timeCategory = 'Night (10pm-6am)';
                            }
                        }
                    } catch (e) {
                        console.warn("Could not parse time:", crimeTime);
                    }
                    
                    // Increment time category counter
                    result.timeCategories[timeCategory]++;
                } else {
                    // If no time data, increment the unknown category
                    result.timeCategories['Unknown']++;
                }
                
                // Record segment information
                if (closestSegment >= 0) {
                    routeSegments[closestSegment].incidentCount++;
                    
                    // Update hottest segment if this one has more incidents
                    if (routeSegments[closestSegment].incidentCount > result.maxSegmentCount) {
                        result.maxSegmentCount = routeSegments[closestSegment].incidentCount;
                        result.hotspotSegment = closestSegment;
                    }
                }
                
                // Add incident to the list
                result.incidents.push({
                    type: crimeType,
                    date: crimeDate,
                    time: crimeTime,
                    coordinates: crimeCoords,
                    distance: minDistance,
                    isRecent: isRecent,
                    description: properties.description || properties.location || 'Unknown',
                    segment: closestSegment,
                    properties: properties  // Add the full properties object
                });
            }
        }
        
        // Find most common time category
        let maxTimeCount = 0;
        for (const [category, count] of Object.entries(result.timeCategories)) {
            if (count > maxTimeCount && category !== 'Unknown') {
                maxTimeCount = count;
                result.mostCommonTime = category;
            }
        }
        
        // Find most common crime type
        let maxTypeCount = 0;
        for (const [type, count] of Object.entries(result.types)) {
            if (count > maxTypeCount) {
                maxTypeCount = count;
                result.mostCommonType = type;
            }
        }
        
        console.log("Crime analysis complete:", result);
        return result;
    } catch (error) {
        console.error("Error counting crime incidents:", error);
        return { count: 0, error: error.message };
    }
};

/**
 * Calculate distance from a point to a line segment
 * @param {Array} point - [lng, lat] of the point or an object with lng/lat properties
 * @param {Array} lineStart - [lng, lat] of line segment start or an object with lng/lat properties
 * @param {Array} lineEnd - [lng, lat] of line segment end or an object with lng/lat properties
 * @returns {Number} Distance in meters
 */
window.distanceToLine = function(point, lineStart, lineEnd) {
    // Handle different coordinate formats
    let pointCoords, startCoords, endCoords;
    
    // Handle point coordinates
    if (Array.isArray(point)) {
        pointCoords = [point[0], point[1]]; // [lng, lat]
    } else if (point && typeof point === 'object') {
        if (point.lng !== undefined && point.lat !== undefined) {
            pointCoords = [point.lng, point.lat];
        } else if (point.coordinates && Array.isArray(point.coordinates)) {
            pointCoords = point.coordinates;
        } else {
            console.error("Invalid point format:", point);
            return Infinity;
        }
    } else {
        console.error("Invalid point:", point);
        return Infinity;
    }
    
    // Handle lineStart coordinates
    if (Array.isArray(lineStart)) {
        startCoords = [lineStart[0], lineStart[1]]; // [lng, lat]
    } else if (lineStart && typeof lineStart === 'object') {
        if (lineStart.lng !== undefined && lineStart.lat !== undefined) {
            startCoords = [lineStart.lng, lineStart.lat];
        } else {
            console.error("Invalid lineStart format:", lineStart);
            return Infinity;
        }
    } else {
        console.error("Invalid lineStart:", lineStart);
        return Infinity;
    }
    
    // Handle lineEnd coordinates
    if (Array.isArray(lineEnd)) {
        endCoords = [lineEnd[0], lineEnd[1]]; // [lng, lat]
    } else if (lineEnd && typeof lineEnd === 'object') {
        if (lineEnd.lng !== undefined && lineEnd.lat !== undefined) {
            endCoords = [lineEnd.lng, lineEnd.lat];
        } else {
            console.error("Invalid lineEnd format:", lineEnd);
            return Infinity;
        }
    } else {
        console.error("Invalid lineEnd:", lineEnd);
        return Infinity;
    }
    
    // Convert to radians
    const toRadians = coord => [coord[0] * Math.PI / 180, coord[1] * Math.PI / 180];
    
    const p = toRadians(pointCoords);
    const s = toRadians(startCoords);
    const e = toRadians(endCoords);
    
    // Earth radius in meters
    const R = 6371000;
    
    // Function to calculate distance between two points using Haversine formula
    const haversine = (p1, p2) => {
        const dLng = p2[0] - p1[0];
        const dLat = p2[1] - p1[1];
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(p1[1]) * Math.cos(p2[1]) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    };
    
    // Calculate distances
    const distSE = haversine(s, e);
    
    // If line segment is too short, just calculate distance to one endpoint
    if (distSE < 1) return haversine(p, s);
    
    // Project point onto line
    const dotProduct = (p1, p2, p3) => {
        return (p2[0] - p1[0]) * (p3[0] - p1[0]) + (p2[1] - p1[1]) * (p3[1] - p1[1]);
    };
    
    const r = dotProduct(s, e, p) / (distSE * distSE);
    
    // If projection is outside the line segment, use distance to closest endpoint
    if (r <= 0) return haversine(p, s);
    if (r >= 1) return haversine(p, e);
    
    // Calculate projected point
    const proj = [
        s[0] + r * (e[0] - s[0]),
        s[1] + r * (e[1] - s[1])
    ];
    
    // Return distance to projected point
    return haversine(p, proj);
};

/**
 * Filters street lamps to show only those near the route
 * @param {Array} route - The route coordinates
 * @param {number} threshold - The distance threshold in meters
 * @returns {number} - The number of filtered street lamps
 */
window.filterStreetLampsNearRoute = async function(route, threshold = 30) {
    if (!route || route.length < 2 || !window.state.streetLamps) {
        return 0;
    }

    const markers = window.state.streetLampMarkers || [];
    let filteredCount = 0;

    // Create route segments for distance calculations
    const segments = [];
    for (let i = 0; i < route.length - 1; i++) {
        segments.push([route[i], route[i + 1]]);
    }

    // Filter markers to show only those near the route
    markers.forEach(marker => {
        const lampPosition = marker.getPosition();
        const point = [lampPosition.lng(), lampPosition.lat()];
        
        // Check if point is near any segment of the route
        let isNearRoute = false;
        for (const segment of segments) {
            const distance = distanceToSegment(point, segment);
            if (distance <= threshold) {
                isNearRoute = true;
                break;
            }
        }
        
        if (isNearRoute) {
            marker.setVisible(true);
            filteredCount++;
        } else {
            marker.setVisible(false);
        }
    });

    console.log(`Filtered ${filteredCount} street lamps near route (within ${threshold}m)`);
    
    // If there are no marker objects but there are raw streetlamp data,
    // count lamps using the raw data and distanceToSegment calculations
    if (filteredCount === 0 && window.state.streetLamps && window.state.streetLamps.length > 0) {
        for (const lamp of window.state.streetLamps) {
            if (!lamp.geometry || !lamp.geometry.coordinates) continue;
            
            const point = lamp.geometry.coordinates;
            
            // Check if point is near any segment of the route
            for (const segment of segments) {
                const distance = distanceToSegment(point, segment);
                if (distance <= threshold) {
                    filteredCount++;
                    break;
                }
            }
        }
        console.log(`Counted ${filteredCount} street lamps near route using raw data (within ${threshold}m)`);
    }
    
    // Store this count globally for other functions to access
    window.visibleLampCount = filteredCount;
    
    return filteredCount;
}; 