/**
 * Streetlight coverage panel functionality
 * Displays a progress bar showing the percentage of the route covered by streetlights
 * and the lamp density per 100 meters
 */

// Initialize the streetlight panel when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log("💡 STREETLIGHT PANEL - DOM loaded, initializing");
    
    // Set up event listener for the streetlight panel collapse button
    const collapseBtn = document.getElementById('streetlight-collapse');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', function(e) {
            const panel = document.getElementById('streetlight-panel');
            if (panel) {
                // Rather than toggling classes, directly check current state
                const isCurrentlyCollapsed = panel.classList.contains('collapsed');
                const icon = this.querySelector('i');
                
                console.log("Current panel state:", isCurrentlyCollapsed ? "collapsed" : "expanded");
                
                if (!isCurrentlyCollapsed) {
                    // Currently expanded, so collapse it
                    panel.classList.add('collapsed');
                    // Directly set the icon class without relying on CSS transforms
                    if (icon) {
                        console.log("Replacing UP arrow with DOWN arrow");
                        icon.className = 'fas fa-chevron-down';
                    }
                } else {
                    // Currently collapsed, so expand it
                    panel.classList.remove('collapsed');
                    // Directly set the icon class without relying on CSS transforms
                    if (icon) {
                        console.log("Replacing DOWN arrow with UP arrow");
                        icon.className = 'fas fa-chevron-up';
                    }
                }
                
                // Update aria-expanded attribute for accessibility
                this.setAttribute('aria-expanded', !isCurrentlyCollapsed);
            }
            
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    // Set the panel to be collapsed by default
    const panel = document.getElementById('streetlight-panel');
    if (panel) {
        panel.classList.add('collapsed');
        
        // Make sure the icon is also set to down initially
        const collapseBtn = document.getElementById('streetlight-collapse');
        if (collapseBtn) {
            const icon = collapseBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        }
    }
    
    // Connect to safety events to automatically update the panel
    connectToSafetyEvents();
});

/**
 * Connects to safety-related events to update the streetlight panel
 */
function connectToSafetyEvents() {
    console.log("💡 STREETLIGHT PANEL - Connecting to safety events");
    
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
    
    // 1. Listen for AI Safety Assessment requests in chat
    const chatSendBtn = document.getElementById('chat-send-btn');
    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', function() {
            console.log("💡 STREETLIGHT PANEL - Chat send button clicked, will check for safety request");
            const chatInput = document.getElementById('chat-input');
            if (chatInput && 
                (chatInput.value.toLowerCase().includes('safety') || 
                 chatInput.value.toLowerCase().includes('streetlight') ||
                 chatInput.value.toLowerCase().includes('lighting'))) {
                console.log("💡 STREETLIGHT PANEL - Safety or lighting request detected in chat");
                
                // Show the panel if it's collapsed
                const panel = document.getElementById('streetlight-panel');
                if (panel && panel.classList.contains('collapsed')) {
                    panel.classList.remove('collapsed');
                    
                    // Update the collapse button icon with direct class setting
                    const collapseBtn = document.getElementById('streetlight-collapse');
                    if (collapseBtn) {
                        const icon = collapseBtn.querySelector('i');
                        if (icon) {
                            console.log("Setting panel to expanded state (UP arrow) after safety chat request");
                            icon.className = 'fas fa-chevron-up';
                        }
                    }
                }
            }
        });
    }
    
    // 3. Watch for new routes being calculated
    if (window.addEventListener) {
        window.addEventListener('routeCalculated', function() {
            console.log("💡 STREETLIGHT PANEL - Route calculated event detected");
            
            // Show the panel if it's collapsed
            const panel = document.getElementById('streetlight-panel');
            if (panel && panel.classList.contains('collapsed')) {
                // Remove collapsed class
                panel.classList.remove('collapsed');
                
                // Update the collapse button icon with direct class setting
                const collapseBtn = document.getElementById('streetlight-collapse');
                if (collapseBtn) {
                    const icon = collapseBtn.querySelector('i');
                    if (icon) {
                        console.log("Setting panel to expanded state (UP arrow) after route calculation");
                        icon.className = 'fas fa-chevron-up';
                    }
                }
            }
        });
    }
}

// Ensure the function is globally available
window.updateStreetlightProgressBar = window.updateStreetlightProgressBar || function(coveragePercentage, lampDensity, routeLength) {
    console.log(`💡 STREETLIGHT PANEL - Updating with coverage: ${coveragePercentage}%, density: ${lampDensity}, length: ${routeLength}m`);
    
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
    
    // Get the safe lamp density constant from safety.js
    const SAFE_LAMP_DENSITY = window.SAFE_LAMP_DENSITY || 1.5;
    
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
};

/**
 * Generates a detailed response about streetlight coverage for the chat bot
 * @param {Object} coverageData - Data about the streetlight coverage
 * @returns {String} A detailed response about the streetlight coverage
 */
window.generateStreetlightDetailedResponse = function(coverageData) {
    // If no data provided, try to extract it from the DOM
    if (!coverageData) {
        coverageData = {
            coveragePercentage: parseFloat(document.getElementById('streetlight-coverage-percent')?.textContent || '0'),
            lampDensity: parseFloat(document.getElementById('lamp-density')?.textContent || '0'),
            routeLength: 0  // Will estimate from other data if available
        };
        
        // Extract route length from the advice text if available
        const adviceText = document.getElementById('streetlight-advice')?.textContent || '';
        const routeLengthMatch = adviceText.match(/(\d+(\.\d+)?)km route/);
        if (routeLengthMatch && routeLengthMatch[1]) {
            coverageData.routeLength = parseFloat(routeLengthMatch[1]) * 1000; // Convert km to meters
        }
    }
    
    // Get constants from safety.js if available
    const SAFE_LAMP_DENSITY = window.SAFE_LAMP_DENSITY || 1.5;
    
    // Format numbers for display
    const coverage = typeof coverageData.coveragePercentage === 'number' ? 
        Math.round(coverageData.coveragePercentage) : 
        parseFloat(coverageData.coveragePercentage);
    
    const density = typeof coverageData.lampDensity === 'number' ? 
        coverageData.lampDensity.toFixed(1) : 
        parseFloat(coverageData.lampDensity).toFixed(1);
    
    const routeLength = coverageData.routeLength ? 
        (coverageData.routeLength / 1000).toFixed(1) : 
        "unknown length";
    
    // Calculate estimated lamp count
    const estimatedLampCount = coverageData.routeLength && coverageData.lampDensity ? 
        Math.round((coverageData.routeLength / 100) * parseFloat(coverageData.lampDensity)) : 
        "unknown number of";
    
    // Create detailed response
    let response = `## 💡 Streetlight Coverage Analysis\n\n`;
    
    // Overall safety assessment based on lighting
    response += `### Overview\n`;
    if (coverage >= 80 && parseFloat(density) >= SAFE_LAMP_DENSITY) {
        response += `Your ${routeLength}km route has **excellent lighting coverage** with **${coverage}%** of the path illuminated by streetlights. This indicates a well-maintained urban area with comprehensive street lighting infrastructure.\n\n`;
    } else if (coverage >= 60 && parseFloat(density) >= SAFE_LAMP_DENSITY * 0.7) {
        response += `Your ${routeLength}km route has **moderate lighting coverage** with **${coverage}%** of the path illuminated by streetlights. This suggests a reasonably well-lit urban or suburban area with some gaps in lighting coverage.\n\n`;
    } else {
        response += `Your ${routeLength}km route has **limited lighting coverage** with only **${coverage}%** of the path illuminated by streetlights. This indicates either a rural area, a poorly maintained urban area, or potentially a park or less developed region.\n\n`;
    }
    
    // Technical details
    response += `### Technical Details\n`;
    response += `- **Coverage Percentage:** ${coverage}% of your route has streetlight illumination\n`;
    response += `- **Lamp Density:** ${density} lamps per 100 meters (${parseFloat(density) * 10} per kilometer)\n`;
    response += `- **Estimated Lamp Count:** Approximately ${estimatedLampCount} streetlights along your route\n`;
    
    // Coverage quality assessment
    response += `\n### Coverage Quality Assessment\n`;
    
    // Density analysis
    if (parseFloat(density) >= SAFE_LAMP_DENSITY * 1.2) {
        response += `- **High Lamp Density:** Your route has exceptional lamp density (${density} per 100m), which typically provides consistent, bright illumination with minimal dark spots.\n`;
    } else if (parseFloat(density) >= SAFE_LAMP_DENSITY) {
        response += `- **Adequate Lamp Density:** Your route has sufficient lamp density (${density} per 100m), generally providing adequate illumination for pedestrian safety.\n`;
    } else if (parseFloat(density) >= SAFE_LAMP_DENSITY * 0.7) {
        response += `- **Moderate Lamp Density:** Your route has a moderate lamp density (${density} per 100m), which may result in some darker areas between light sources.\n`;
    } else {
        response += `- **Low Lamp Density:** Your route has a low lamp density (${density} per 100m), likely resulting in significant dark patches between streetlights.\n`;
    }
    
    // Coverage distribution analysis
    if (coverage >= 90) {
        response += `- **Comprehensive Coverage:** With ${coverage}% coverage, nearly the entire route is illuminated, suggesting even distribution of streetlights.\n`;
    } else if (coverage >= 75) {
        response += `- **Good Coverage Distribution:** With ${coverage}% coverage, most of the route is illuminated, with potentially just a few small unlit segments.\n`;
    } else if (coverage >= 50) {
        response += `- **Partial Coverage:** With ${coverage}% coverage, approximately half of your route has streetlight illumination, suggesting significant gaps between lit areas.\n`;
    } else {
        response += `- **Limited Coverage:** With only ${coverage}% coverage, the majority of your route lacks streetlight illumination, suggesting large unlit segments.\n`;
    }
    
    // Safety considerations
    response += `\n### Safety Implications\n`;
    
    if (coverage >= 80 && parseFloat(density) >= SAFE_LAMP_DENSITY) {
        response += `- **Optimal Visibility:** This level of lighting typically provides excellent visibility for pedestrians, making it easier to see potential hazards, obstacles, and other people.\n`;
        response += `- **Enhanced Security:** Well-lit routes generally discourage criminal activity and increase the perception of safety.\n`;
        response += `- **Good for Navigation:** Consistent lighting makes it easier to navigate and identify landmarks at night.\n`;
    } else if (coverage >= 60 && parseFloat(density) >= SAFE_LAMP_DENSITY * 0.7) {
        response += `- **Adequate Visibility:** This level of lighting generally provides sufficient visibility for most pedestrians, though there may be some darker areas requiring additional caution.\n`;
        response += `- **Reasonable Security:** Mostly lit routes offer a moderate level of security, though darker segments may exist.\n`;
        response += `- **Consider a Flashlight:** For the ${100-coverage}% of the route without street lighting, carrying a personal light source is advisable.\n`;
    } else {
        response += `- **Limited Visibility:** This level of lighting may provide inadequate visibility in many sections, making it difficult to see potential hazards, particularly in the ${100-coverage}% of unlit areas.\n`;
        response += `- **Security Concerns:** Poorly lit routes may present security challenges, particularly in urban areas.\n`;
        response += `- **Alternative Routes Recommended:** If traveling at night, consider alternative, better-lit routes if available.\n`;
        response += `- **Personal Lighting Essential:** A flashlight or phone light is highly recommended for navigating darker sections.\n`;
    }
    
    // Time of day considerations
    response += `\n### Time of Day Considerations\n`;
    response += `- **Daytime Travel:** During daylight hours, streetlight coverage is generally not a concern for this route.\n`;
    
    if (coverage >= 70 && parseFloat(density) >= SAFE_LAMP_DENSITY) {
        response += `- **Evening Travel (Dusk/Dawn):** This route should be adequately lit during dusk and dawn hours.\n`;
        response += `- **Night Travel:** This route provides sufficient lighting for nighttime travel, though standard precautions should still be observed.\n`;
    } else if (coverage >= 50 && parseFloat(density) >= SAFE_LAMP_DENSITY * 0.7) {
        response += `- **Evening Travel (Dusk/Dawn):** This route may have some darker sections during dusk and dawn hours, but should generally be navigable.\n`;
        response += `- **Night Travel:** Use caution when traveling this route at night, as some sections may be inadequately lit.\n`;
    } else {
        response += `- **Evening Travel (Dusk/Dawn):** Consider alternative routes during dusk and dawn hours, as significant portions of this path may be poorly lit.\n`;
        response += `- **Night Travel:** Not recommended for nighttime travel unless necessary. If you must use this route at night, travel with companions if possible and bring additional lighting.\n`;
    }
    
    // Weather impact
    response += `\n### Weather Impact on Visibility\n`;
    if (coverage < 60) {
        response += `- **Rainy Conditions:** Limited streetlight coverage of ${coverage}% could make this route particularly challenging during rain, when visibility is further reduced and reflections can be disorienting.\n`;
        response += `- **Foggy Conditions:** Fog significantly reduces the effectiveness of the limited streetlights, potentially making this route very difficult to navigate safely.\n`;
    } else {
        response += `- **Rainy Conditions:** The ${coverage}% streetlight coverage should provide adequate guidance during rain, though reflections on wet surfaces can sometimes cause glare.\n`;
        response += `- **Foggy Conditions:** During fog, even well-placed streetlights have reduced effectiveness, though the ${density} lamps per 100m should still provide some guidance.\n`;
    }
    
    // Recommendations
    response += `\n### Recommendations\n`;
    if (coverage < 60 || parseFloat(density) < SAFE_LAMP_DENSITY) {
        response += `- Consider alternative routes for nighttime travel if safety is a concern\n`;
        response += `- Carry a flashlight or use your phone's light function in darker sections\n`;
        response += `- Wear reflective clothing to increase your visibility to others\n`;
        response += `- Consider traveling with companions when possible\n`;
    } else {
        response += `- This route has adequate lighting for most situations\n`;
        response += `- As with any route, maintain awareness of your surroundings\n`;
        response += `- Consider reflective elements on clothing or accessories for added visibility\n`;
    }
    
    // Comparative context to help understand the numbers
    response += `\n### Comparative Context\n`;
    response += `- **Urban Standard:** Well-lit urban areas typically have 1.5-2.0 lamps per 100m with 80%+ coverage\n`;
    response += `- **Suburban Average:** Suburban areas often have 1.0-1.5 lamps per 100m with 60-80% coverage\n`;
    response += `- **Rural Typical:** Rural routes frequently have <0.5 lamps per 100m with <40% coverage\n`;
    
    // Technical note for clarity
    response += `\n_Analysis based on OpenStreetMap street lamp data with ${coverage}% route coverage and ${density} lamps per 100m density._`;
    
    return response;
}; 