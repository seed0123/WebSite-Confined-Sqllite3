let scatterChart;
const deviceData = {};
const deviceIndexMap = {}; // Maps device index to original device name
let deviceNames = [];
let lastKnownTemperature = {}; // Track last known temperature for each device
let consecutiveSameTemperatureCount = {}; // Track consecutive same temperature counts
const shapes = ['circle', 'triangle', 'rect', 'cross', 'star', 'line', 'dash'];
const minX = 0, maxX = 100, minY = 0, maxY = 100; // Coordinate boundaries

document.addEventListener("DOMContentLoaded", function () {
    const urlParams = new URLSearchParams(window.location.search);
    const permit = urlParams.get('permit');

    if (permit) {
        document.getElementById('permitTitle').textContent = permit.charAt(0).toUpperCase() + permit.slice(1) + " Devices";
        initializeScatterPlot();
        fetchAndRenderDevices(permit); // Initial fetch and render
        setInterval(() => fetchAndRenderDevices(permit), 15000); // Auto update every 15 seconds
        updateLastUpdatedTime(); // Update initial last updated time
        setInterval(updateLastUpdatedTime, 1000); // Update last updated time every second
    }

    const deviceForm = document.getElementById('deviceForm');
    deviceForm.addEventListener('submit', function(event) {
        event.preventDefault();
        deviceNames = [];
        const formData = new FormData(deviceForm);
        for (let [key, value] of formData.entries()) {
            deviceNames.push(value || `Device ${deviceNames.length + 1}`);
        }
        fetchAndRenderDevices(permit); // Re-fetch and render with new names
    });
});

function initializeScatterPlot() {
    const ctx = document.getElementById('movementChart').getContext('2d');
    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Devices',
                data: [], // Empty initially
                backgroundColor: function(context) {
                    const isMoving = context.raw?.isMoving;
                    return isMoving === 2 ? 'green' : (isMoving === 1 ? 'orange' : 'red');
                },
                pointStyle: function(context) {
                    return shapes[context.dataIndex % shapes.length]; // Assign a shape based on device index
                }
            }]
        },
        options: {
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    min: minX,
                    max: maxX
                },
                y: {
                    type: 'linear',
                    min: minY,
                    max: maxY
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        generateLabels: function(chart) {
                            const data = chart.data.datasets[0].data;
                            return data.map((device, index) => ({
                                text: deviceNames[index] || `Device ${index + 1}`,
                                fillStyle: chart.data.datasets[0].backgroundColor[index],
                                strokeStyle: chart.data.datasets[0].backgroundColor[index],
                                pointStyle: shapes[index % shapes.length]
                            }));
                        }
                    }
                }
            }
        }
    });
}

async function fetchAndRenderDevices(permit) {
    const channels = {
        kilns: ['2573701', '2581068'],
        preheaters: ['2599736', '2581071'],
        crushers: ['2581072', '2581073']
    };

    const channelIds = channels[permit] || [];

    for (let index = 0; index < channelIds.length; index++) {
        const channelId = channelIds[index];
        try {
            const response = await fetch(`https://api.thingspeak.com/channels/${channelId}/feeds.json?results=1`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            const feeds = data.feeds;
            const originalDeviceName = `Device ${index + 1}`; // Use this as the key for deviceData
            const deviceName = deviceNames[index] || originalDeviceName;

            if (feeds.length > 0) {
                const lastFeed = feeds[0];
                let isMoving = mapMovementStatus(lastFeed.field2); // Map field2 to 0, 1, or 2
                const temperature = parseFloat(lastFeed.field1).toFixed(2);

                let xCoordinate, yCoordinate;

                // Determine if device is powered off
                let powerOffStatus = false;
                if (lastKnownTemperature[originalDeviceName] === temperature) {
                    consecutiveSameTemperatureCount[originalDeviceName] = consecutiveSameTemperatureCount[originalDeviceName] ? consecutiveSameTemperatureCount[originalDeviceName] + 1 : 1;
                    if (consecutiveSameTemperatureCount[originalDeviceName] >= 2) {
                        powerOffStatus = true;
                    }
                } else {
                    lastKnownTemperature[originalDeviceName] = temperature;
                    consecutiveSameTemperatureCount[originalDeviceName] = 0;
                }

                if (powerOffStatus) {
                    // Retain the last known coordinates if the device is powered off
                    xCoordinate = deviceData[originalDeviceName]?.x || getRandomInRange(minX, maxX);
                    yCoordinate = deviceData[originalDeviceName]?.y || getRandomInRange(minY, maxY);
                    isMoving = 0; // Set isMoving to 0 if the device is powered off
                } else if (isMoving === 2 || !deviceData[originalDeviceName]) {
                    // Generate new random coordinates if device is moving or it has no previous data
                    xCoordinate = getRandomInRange(minX, maxX);
                    yCoordinate = getRandomInRange(minY, maxY);

                    // Update coordinates if the device is moving
                    if (isMoving === 2 && deviceData[originalDeviceName]) {
                        xCoordinate = deviceData[originalDeviceName].x + getRandomMovement();
                        yCoordinate = deviceData[originalDeviceName].y + getRandomMovement();
                    }

                    // Ensure coordinates stay within bounds
                    xCoordinate = Math.max(minX, Math.min(maxX, xCoordinate));
                    yCoordinate = Math.max(minY, Math.min(maxY, yCoordinate));
                } else {
                    // Retain the last known coordinates if the device is not moving
                    xCoordinate = deviceData[originalDeviceName].x;
                    yCoordinate = deviceData[originalDeviceName].y;
                }

                // Update device data for scatter plot
                deviceData[originalDeviceName] = { x: xCoordinate, y: yCoordinate, isMoving };

                deviceIndexMap[index] = originalDeviceName; // Map index to original device name

                renderOrUpdateDevice(deviceName, isMoving, temperature, index, powerOffStatus);

                // Send data to server after rendering device if not powered off
                if (!powerOffStatus) {
                    sendDataToServer(deviceName, isMoving, temperature);
                }
            }
        } catch (error) {
            console.error('Error fetching device data:', error);
        }
    }
    updateScatterPlot();
}

function mapMovementStatus(field2) {
    switch (field2) {
        case '0':
            return 0; // No Movement
        case '1':
            return 1; // Warning
        case '2':
            return 2; // Movement Detected
        default:
            return 0; // Default to No Movement
    }
}

function renderOrUpdateDevice(deviceName, isMoving, temperature, index, powerOffStatus) {
    const container = document.getElementById('deviceContainer');
    let deviceElement = document.querySelector(`.device[data-index="${index}"]`);

    if (!deviceElement) {
        deviceElement = document.createElement('div');
        deviceElement.classList.add('device');
        deviceElement.setAttribute('data-index', index);

        const trafficLightDiv = document.createElement('div');
        trafficLightDiv.classList.add('traffic-light', trafficLightClass(isMoving, powerOffStatus));

        // Add unique classes or IDs to identify child elements
        deviceElement.innerHTML = `
            <strong class="device-name">${deviceName}</strong><br>
            <span class="device-temperature">${powerOffStatus ? 'Device Powered Off' : `Temperature: ${temperature}°C`}</span><br>
            <span class="device-movement">${powerOffStatus ? '' : `Movement: ${movementText(isMoving)}`}</span>
        `;

        deviceElement.appendChild(trafficLightDiv);
        container.appendChild(deviceElement);
    } else {
        updateDevice(deviceElement, deviceName, isMoving, temperature, powerOffStatus);
    }
}

function updateDevice(deviceElement, deviceName, isMoving, temperature, powerOffStatus) {
    const trafficLightDiv = deviceElement.querySelector('.traffic-light');
    trafficLightDiv.className = 'traffic-light ' + trafficLightClass(isMoving, powerOffStatus);

    // Use class names to select the correct elements
    const deviceNameEl = deviceElement.querySelector('.device-name');
    const temperatureEl = deviceElement.querySelector('.device-temperature');
    const movementEl = deviceElement.querySelector('.device-movement');

    deviceNameEl.textContent = deviceName;
    temperatureEl.textContent = powerOffStatus ? 'Device Powered Off' : `Temperature: ${temperature}°C`;
    movementEl.textContent = powerOffStatus ? '' : `Movement: ${movementText(isMoving)}`
}

function trafficLightClass(isMoving, powerOffStatus) {
    if (powerOffStatus) {
        return 'red'; // Device is powered off
    }
    switch (isMoving) {
        case 0:
            return 'red'; // No Movement
        case 1:
            return 'orange'; // Warning
        case 2:
            return 'green'; // Movement Detected
        default:
            return 'red'; // Default to No Movement
    }
}

function movementText(isMoving) {
    switch (isMoving) {
        case 0:
            return 'No Movement';
        case 1:
            return 'Warning';
        case 2:
            return 'Movement Detected';
        default:
            return 'No Movement';
    }
}

function getRandomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

function getRandomMovement() {
    return Math.random() * 2 - 1; // Random value between -1 and 1
}

function updateScatterPlot() {
    const scatterData = [];
    for (const device in deviceData) {
        scatterData.push({
            x: deviceData[device].x,
            y: deviceData[device].y,
            isMoving: deviceData[device].isMoving
        });
    }
    scatterChart.data.datasets[0].data = scatterData;
    scatterChart.update();
}

function sendDataToServer(deviceName, isMoving, temperature) {
    const payload = {
        deviceName,
        isMoving,
        temperature
    };

    fetch('/api/device-data', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        console.log('Data sent to server successfully:', data);
    })
    .catch(error => {
        console.error('Error sending data to server:', error);
    });
}

function updateLastUpdatedTime() {
    const lastUpdatedElement = document.getElementById('lastUpdated');
    const now = new Date();
    lastUpdatedElement.textContent = `Last Updated: ${now.toLocaleString()}`;
}
