/**
 * Safety analysis module for evaluating route lighting based on street lamp data
 */

// Constants for safety analysis
const DEFAULT_LAMP_BUFFER = 25; // meters
const SAFE_LAMP_DENSITY = 1.5; // lamps per 100 meters is considered well-lit

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
    
    // Calculate how many lamps are within the buffer distance of the route
    const lampsNearRoute = window.countStreetLampsAlongRoute 
        ? window.countStreetLampsAlongRoute(route, streetLamps, DEFAULT_LAMP_BUFFER)
        : 0;
    
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
                lamp.lat, lamp.lng, 
                segmentStart.lat, segmentStart.lng
            );
            const distToEnd = haversineDistance(
                lamp.lat, lamp.lng, 
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
    
    return {
        routeLength: Math.round(routeLength),
        lampCount: lampsNearRoute,
        lampDensity: lampDensity.toFixed(2),
        coveragePercentage: coveragePercentage.toFixed(1),
        safetyLevel
    };
};

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
                // Count actual marker elements on the map
                const markerElements = document.querySelectorAll('.mapboxgl-marker');
                if (markerElements && markerElements.length > 0) {
                    actualMarkerCount = markerElements.length;
                    console.log("Counted actual marker DOM elements:", actualMarkerCount);
                }
            }
        } catch (e) {
            console.error("Error counting markers:", e);
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
        crimeInfo = `I've identified ${actualMarkerCount} reported crime incidents along your route (visible as markers on the map).`;
        
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
            // Sort incidents by recency and proximity
            const sortedIncidents = [...crimeData.incidents].sort((a, b) => {
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
                return a.distance - b.distance;
            });
            
            // Take exactly 3 most recent/relevant incidents (or fewer if not available)
            const notableIncidents = sortedIncidents.slice(0, Math.min(3, sortedIncidents.length));
            
            if (notableIncidents.length > 0) {
                crimeInfo += "\n\nMost recent crime incidents on your route:";
                
                notableIncidents.forEach((incident, index) => {
                    // Get all available properties from the incident
                    const properties = incident.properties || {};
                    
                    // Extract detailed date information
                    let dateInfo = "Date unknown";
                    if (incident.date) {
                        try {
                            const date = new Date(incident.date);
                            if (!isNaN(date)) {
                                dateInfo = date.toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric'
                                });
                            } else {
                                // If date parsing fails, use raw fields from properties
                                const day = properties.incday || properties.eventday;
                                const month = properties.incmonth || properties.eventmth;
                                const year = properties.incyear || properties.eventyr;
                                if (day && month && year) {
                                    dateInfo = `${day}, ${month} ${year}`;
                                } else if (month && year) {
                                    dateInfo = `${month} ${year}`;
                                } else {
                                    dateInfo = incident.date;
                                }
                            }
                        } catch (e) {
                            dateInfo = incident.date;
                        }
                    } else if (properties) {
                        // Try to reconstruct date from individual fields
                        const day = properties.incday || properties.eventday;
                        const month = properties.incmonth || properties.eventmth;
                        const year = properties.incyear || properties.eventyr;
                        if (day && month && year) {
                            dateInfo = `${day}, ${month} ${year}`;
                        } else if (month && year) {
                            dateInfo = `${month} ${year}`;
                        }
                    }
                    
                    // Format the time with proper formatting
                    let timeInfo = "Time unknown";
                    if (incident.time && incident.time !== 'Unknown') {
                        timeInfo = incident.time;
                    } else if (properties && properties.incsttm) {
                        timeInfo = properties.incsttm;
                    }
                    
                    // Military time to standard time conversion
                    if (timeInfo.match(/^\d{1,2}:\d{2}$/)) {
                        try {
                            const [hours, minutes] = timeInfo.split(':');
                            const hour = parseInt(hours, 10);
                            if (hour > 12) {
                                timeInfo = `${hour - 12}:${minutes}pm`;
                            } else if (hour === 12) {
                                timeInfo = `12:${minutes}pm`;
                            } else if (hour === 0) {
                                timeInfo = `12:${minutes}am`;
                            } else {
                                timeInfo = `${hour}:${minutes}am`;
                            }
                        } catch (e) {
                            // Keep original time format if conversion fails
                        }
                    }
                    
                    // Get detailed crime type
                    let crimeType = incident.type || 'Unknown crime';
                    if (properties && properties.bcsrcat) {
                        crimeType = properties.bcsrcat;
                    }
                    
                    // Get detailed location information
                    let locationInfo = "Unknown location";
                    if (properties && properties.locsurb) {
                        locationInfo = properties.locsurb;
                        // Add more location context if available
                        if (properties.locprmc1) {
                            locationInfo += ` (${properties.locprmc1})`;
                        }
                    } else if (incident.description && incident.description !== 'Unknown') {
                        locationInfo = incident.description;
                    }
                    
                    // Get additional details about perpetrator if available
                    let perpetratorInfo = "";
                    if (properties) {
                        const sex = properties.poisex;
                        const age = properties.poi_age;
                        if (sex && sex !== ' ' && age && parseFloat(age) > 0) {
                            perpetratorInfo = ` Perpetrator: ${sex === 'M' ? 'Male' : (sex === 'F' ? 'Female' : sex)}, age ${Math.round(parseFloat(age))}.`;
                        } else if (sex && sex !== ' ') {
                            perpetratorInfo = ` Perpetrator: ${sex === 'M' ? 'Male' : (sex === 'F' ? 'Female' : sex)}.`;
                        } else if (age && parseFloat(age) > 0) {
                            perpetratorInfo = ` Perpetrator age: ${Math.round(parseFloat(age))}.`;
                        }
                    }
                    
                    // Format detailed incident information
                    crimeInfo += `\n- INCIDENT ${index + 1}: ${crimeType} on ${dateInfo} at ${timeInfo}. Location: ${locationInfo}. Distance: ${Math.round(incident.distance)} meters from route.${perpetratorInfo}`;
                });
            }
        }
        
        // Generate crime type breakdown
        const typeEntries = Object.entries(crimeData.types);
        if (typeEntries.length > 0 && typeEntries[0][0] !== 'Unknown') {
            crimeInfo += "\n\nBreakdown of incident types:";
            
            typeEntries.sort((a, b) => b[1] - a[1]); // Sort by count (descending)
            
            typeEntries.forEach(([type, count]) => {
                const percentage = Math.round((count / crimeData.count) * 100);
                crimeInfo += `\n- ${type}: ${count} (${percentage}%)`;
            });
        }
        
        // Try to get LGA information for the route
        if (window.state && window.state.currentRoute) {
            try {
                // Check if we have LGA info from the analysis result
                if (analysisResult.lgaInfo && analysisResult.lgaInfo.lgaData && analysisResult.lgaInfo.lgaData.length > 0) {
                    const lgaInfoData = analysisResult.lgaInfo;
                    
                    // Start with offense type information
                    lgaInfo = `\n\nLocal Government Area (LGA) Crime Statistics:`;
                    lgaInfo += `\nOffense type analyzed: ${lgaInfoData.offense || "Domestic violence related assault incidents"}`;
                    
                    // Add information for each matched LGA
                    lgaInfoData.lgaData.forEach((lga, index) => {
                        if (index > 0) lgaInfo += "\n";
                        
                        lgaInfo += `\n\n📊 ${lga.lga} Crime Statistics:`;
                        
                        // Extract metrics
                        const metrics = lga.metrics || {};
                        
                        // Add incident count
                        if (metrics.incidents) {
                            lgaInfo += `\n- Total reported incidents: ${metrics.incidents}`;
                        }
                        
                        // Add crime rate
                        if (metrics.rate) {
                            lgaInfo += `\n- Rate per 100,000 population: ${metrics.rate}`;
                        }
                        
                        // Add rank information
                        if (metrics.rank) {
                            lgaInfo += `\n- Rank among NSW LGAs: ${metrics.rank}`;
                            
                            // Assess safety level based on rank
                            const rankNum = parseInt(metrics.rank, 10);
                            if (!isNaN(rankNum)) {
                                if (rankNum <= 30) {
                                    lgaInfo += " (High crime area)";
                                } else if (rankNum <= 60) {
                                    lgaInfo += " (Moderate crime area)";
                                } else {
                                    lgaInfo += " (Lower crime area)";
                                }
                            }
                        }
                        
                        // Add safety implications
                        if (metrics.incidents && metrics.rate) {
                            const incidents = parseInt(metrics.incidents, 10);
                            const rate = parseFloat(metrics.rate);
                            
                            if (!isNaN(incidents) && !isNaN(rate)) {
                                // Provide more detailed safety implications
                                if (rate > 500) {
                                    lgaInfo += `\n- Safety assessment: Higher than average crime rates in this LGA. Exercise increased caution.`;
                                } else if (rate > 250) {
                                    lgaInfo += `\n- Safety assessment: Moderate crime rates in this LGA. Normal precautions advised.`;
                                } else {
                                    lgaInfo += `\n- Safety assessment: Lower than average crime rates in this LGA.`;
                                }
                            }
                        }
                    });
                    
                    // Add overall safety recommendations based on LGA data
                    if (lgaInfoData.lgaData.length > 0) {
                        const highestRiskLga = lgaInfoData.lgaData.reduce((prev, current) => {
                            const prevRate = prev.metrics && prev.metrics.rate ? parseFloat(prev.metrics.rate) || 0 : 0;
                            const currRate = current.metrics && current.metrics.rate ? parseFloat(current.metrics.rate) || 0 : 0;
                            return currRate > prevRate ? current : prev;
                        }, lgaInfoData.lgaData[0]);
                        
                        const rate = highestRiskLga.metrics && highestRiskLga.metrics.rate ? parseFloat(highestRiskLga.metrics.rate) : 0;
                        
                        if (rate > 500) {
                            lgaInfo += `\n\nYour route passes through areas with significantly higher than average crime rates. Take extra precautions, especially at night.`;
                        } else if (rate > 250) {
                            lgaInfo += `\n\nYour route passes through areas with moderate crime rates. Be aware of your surroundings, particularly after dark.`;
                        } else {
                            lgaInfo += `\n\nYour route passes through areas with lower than average crime rates, but normal safety precautions are still recommended.`;
                        }
                    }
                }
                
                // Get the midpoint of the route to determine LGA (legacy code - keep as fallback)
                if (!lgaInfo && typeof window.getLgaInfoForCoordinates === 'function') {
                    const routeCoords = window.state.currentRoute;
                    const midpointIndex = Math.floor(routeCoords.length / 2);
                    const midpoint = routeCoords[midpointIndex];
                    
                    // Try to get LGA data if available
                    const lgaData = window.getLgaInfoForCoordinates(midpoint[1], midpoint[0]); // lat, lng
                    
                    if (lgaData && lgaData.name) {
                        lgaInfo = `\n\nSuburb/LGA Information for ${lgaData.name}:`;
                        
                        if (lgaData.crimeCount) {
                            lgaInfo += `\n- Total reported crimes: ${lgaData.crimeCount}`;
                        }
                        
                        if (lgaData.crimeRate) {
                            lgaInfo += `\n- Crime rate: ${lgaData.crimeRate} per 100,000 population`;
                        }
                        
                        if (lgaData.rank) {
                            lgaInfo += `\n- Safety ranking: ${lgaData.rank} out of ${lgaData.totalLgas || 'NSW LGAs'}`;
                        }
                        
                        if (lgaData.mostCommonCrime) {
                            lgaInfo += `\n- Most common offence: ${lgaData.mostCommonCrime}`;
                        }
                        
                        if (lgaData.crimeRatings) {
                            lgaInfo += `\n- Area safety assessment: ${lgaData.crimeRatings}`;
                        }
                    }
                }
            } catch (error) {
                console.error("Error getting LGA information:", error);
            }
        }
    } else {
        crimeInfo = "I found no reported crime incidents along your route.";
        
        // Still try to get LGA information even if no incidents on the route
        // Similar code as above for LGA lookup...
    }
    
    // Calculate the route lighting information
    const roundedPercentageLit = Math.round(percentageLit);
    
    // Generate lighting assessment with specific numbers about street lamps
    lightingInfo = `Your route has ${lampCount} street lamps. `;
    
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
    response += recommendations;
    
    // Add overall safety rating
    let safetyRating = "";
    if (crimeData && crimeData.count > 0) {
        if (crimeData.count > 20 || roundedPercentageLit < 30) {
            safetyRating = "⚠️ EXERCISE CAUTION: This route has significant safety concerns due to high crime rates and/or poor lighting.";
        } else if (crimeData.count > 5 || roundedPercentageLit < 60) {
            safetyRating = "⚠️ USE CAUTION: This route has moderate safety concerns due to some crime incidents and/or limited lighting.";
        } else {
            safetyRating = "✅ GENERALLY SAFE: This route appears relatively safe, but remain aware of your surroundings as usual.";
        }
    } else if (roundedPercentageLit < 50) {
        safetyRating = "⚠️ USE CAUTION: While no crime data was found, this route has limited lighting which may pose safety concerns.";
    } else {
        safetyRating = "✅ APPEARS SAFE: Based on available data, this route appears relatively safe.";
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
    
    // First, check if this is an LGA crime stats query - if so, it's NOT a safety query
    // This needs to match our isLgaCrimeStatsQuery logic in chat.js
    const lgaKeywords = ['lga', 'local government', 'area', 'suburb', 'region', 'city', 'town'];
    const crimeKeywords = ['crime', 'robbery', 'robberies', 'assault', 'theft', 'break', 
                         'steal', 'homicide', 'murder', 'violence', 'offence', 'offense'];
    
    const hasLgaKeyword = lgaKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasCrimeKeyword = crimeKeywords.some(keyword => lowerMessage.includes(keyword));
    
    // Check if this appears to be an LGA crime query
    const looksLikeLgaQuery = (hasLgaKeyword && hasCrimeKeyword) || 
                              (hasCrimeKeyword && !lowerMessage.includes('route') && !lowerMessage.includes('path'));
    
    // If it seems like an LGA query, don't treat it as a safety query
    if (looksLikeLgaQuery) {
        console.log("Message appears to be an LGA crime query, not a route safety query");
        return false;
    }
    
    // Otherwise, continue with normal safety query detection
    const safetyKeywords = [
        'safe', 'safety', 'danger', 'dangerous', 'light', 'lighting', 'lit',
        'well lit', 'well-lit', 'dark', 'night', 'evening', 'lamps', 'street lamp'
    ];
    
    // Check for common safety question patterns
    const isQuestion = /\?|how|is .*\?|are .*\?/.test(lowerMessage);
    const mentionsRoute = /route|path|way|road|street|walk|walking/.test(lowerMessage);
    
    // Check for safety keywords
    const hasSafetyKeyword = safetyKeywords.some(keyword => 
        lowerMessage.includes(keyword)
    );
    
    // Determine if this is likely a safety query
    return (isQuestion && mentionsRoute && hasSafetyKeyword) || 
           (lowerMessage.includes('how safe') && mentionsRoute) ||
           (lowerMessage.includes('how well lit') && mentionsRoute) ||
           (lowerMessage.includes('street lamp') && mentionsRoute);
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
window.countCrimeIncidentsAlongRoute = function(route, bufferDistance = 2) {
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
        for (const feature of crimeData.features) {
            if (!feature.geometry || !feature.geometry.coordinates) continue;
            
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