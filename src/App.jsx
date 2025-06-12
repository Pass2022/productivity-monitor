import React, { useState, useEffect, useRef } from 'react';

// Main App component for the Chrome Extension
const App = () => {
    // State to store the active tab's URL
    const [activeTabUrl, setActiveTabUrl] = useState('No active tab');
    // State to store the accumulated tab activity data
    const [tabActivity, setTabActivity] = useState({});
    // Ref to hold the ID of the currently active tab
    const activeTabIdRef = useRef(null);
    // Ref to hold the timestamp when the current tab became active
    const tabActivationTimeRef = useRef(null);

    // Function to safely access chrome API methods, or provide a mock
    // This allows the React app to run outside of a Chrome Extension environment for development/testing
    const getChromeApi = () => {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.storage && chrome.windows) {
            return chrome;
        } else {
            console.warn('Chrome Extension API not available. Running in non-extension environment (using mock storage).');
            // Mock chrome API for local development outside of a browser extension
            return {
                storage: {
                    local: {
                        get: (keys, callback) => {
                            console.log('Mocking chrome.storage.local.get for keys:', keys);
                            callback({ tabActivity: JSON.parse(localStorage.getItem('mockTabActivity') || '{}') });
                        },
                        set: (items) => {
                            console.log('Mocking chrome.storage.local.set with items:', items);
                            localStorage.setItem('mockTabActivity', JSON.stringify(items.tabActivity));
                        },
                    },
                },
                tabs: {
                    query: (queryInfo, callback) => {
                        console.log('Mocking chrome.tabs.query for query:', queryInfo);
                        callback([{ id: 0, url: 'https://example.com/mock-tab' }]); // Default mock tab
                    },
                    get: (tabId, callback) => {
                        console.log('Mocking chrome.tabs.get for tabId:', tabId);
                        callback({ id: tabId, url: 'https://example.com/mock-tab-' + tabId });
                    },
                    onActivated: {
                        addListener: (callback) => {
                            console.log('Mocking chrome.tabs.onActivated.addListener');
                        },
                        removeListener: () => console.log('Mocking chrome.tabs.onActivated.removeListener'),
                    },
                },
                windows: {
                    onFocusChanged: {
                        addListener: (callback) => {
                            console.log('Mocking chrome.windows.onFocusChanged.addListener');
                        },
                        removeListener: () => console.log('Mocking chrome.windows.onFocusChanged.removeListener'),
                        WINDOW_ID_NONE: -1, // Mock constant
                    },
                },
            };
        }
    };

    const currentChrome = getChromeApi();

    // useEffect hook to initialize the extension and set up listeners
    useEffect(() => {
        // Function to load existing tab activity from local storage
        const loadTabActivity = async () => {
            // Check if chrome.storage is available before trying to use it
            if (!currentChrome || !currentChrome.storage) {
                console.warn("Chrome storage API not available, cannot load activity.");
                return;
            }
            try {
                const result = await new Promise((resolve) => {
                    currentChrome.storage.local.get(['tabActivity'], resolve);
                });
                if (result.tabActivity) {
                    setTabActivity(result.tabActivity);
                }
            } catch (error) {
                console.error('Error loading tab activity:', error);
            }
        };

        // Function to get the initially active tab when the extension popup opens
        const getActiveTab = async () => {
            // Check if chrome.tabs is available before trying to use it
            if (!currentChrome || !currentChrome.tabs) {
                console.warn("Chrome tabs API not available, cannot get active tab.");
                return;
            }
            try {
                const tabs = await new Promise((resolve) => {
                    // Query for the active tab in the current window
                    currentChrome.tabs.query({ active: true, currentWindow: true }, resolve);
                });
                if (tabs && tabs.length > 0) {
                    const tab = tabs[0];
                    activeTabIdRef.current = tab.id;
                    setActiveTabUrl(tab.url || 'Unknown URL');
                    tabActivationTimeRef.current = Date.now();
                }
            } catch (error) {
                console.error('Error getting active tab:', error);
            }
        };

        // Function to update the duration for the previously active tab
        const updatePreviousTabDuration = () => {
            // Only update if there was an active tab being tracked and storage is available
            if (activeTabIdRef.current && tabActivationTimeRef.current && currentChrome && currentChrome.storage) {
                const duration = Date.now() - tabActivationTimeRef.current;
                setTabActivity(prevActivity => {
                    const newActivity = { ...prevActivity };
                    const url = activeTabUrl; // Use the URL stored in state for the previous tab

                    // Add duration to the existing total for this URL, or start a new entry
                    if (newActivity[url]) {
                        newActivity[url] += duration;
                    } else {
                        newActivity[url] = duration;
                    }
                    // Persist the updated activity to local storage
                    currentChrome.storage.local.set({ tabActivity: newActivity });
                    return newActivity;
                });
            }
        };

        // Listener for when a tab becomes active (user switches tabs)
        const handleTabActivated = async (activeInfo) => {
            // Ensure chrome.tabs API is available
            if (!currentChrome || !currentChrome.tabs) return;

            // First, update the duration for the tab that was previously active
            updatePreviousTabDuration();

            try {
                // Get details of the newly activated tab
                const tab = await new Promise((resolve) => {
                    currentChrome.tabs.get(activeInfo.tabId, resolve);
                });
                if (tab) {
                    // Set the newly active tab's ID, URL, and activation time
                    activeTabIdRef.current = tab.id;
                    setActiveTabUrl(tab.url || 'Unknown URL');
                    tabActivationTimeRef.current = Date.now();
                }
            } catch (error) {
                console.error('Error handling tab activated:', error);
            }
        };

        // Listener for when the browser window focus changes (e.g., user switches to another application)
        const handleWindowFocusChanged = async (windowId) => {
            // Ensure chrome APIs are available
            if (!currentChrome || !currentChrome.tabs || !currentChrome.windows) return;

            if (windowId === currentChrome.windows.WINDOW_ID_NONE) {
                // Browser window lost focus (e.g., user went to another app)
                // Record duration for the current tab before it loses focus
                updatePreviousTabDuration();
                activeTabIdRef.current = null; // No active tab being tracked by the extension
                tabActivationTimeRef.current = null;
                setActiveTabUrl('No active tab (window unfocused)');
            } else {
                // Browser window gained focus
                try {
                    // Find the active tab within the newly focused window
                    const tabs = await new Promise((resolve) => {
                        currentChrome.tabs.query({ active: true, windowId: windowId }, resolve);
                    });
                    if (tabs && tabs.length > 0) {
                        const tab = tabs[0];
                        // Start tracking the newly active tab
                        activeTabIdRef.current = tab.id;
                        setActiveTabUrl(tab.url || 'Unknown URL');
                        tabActivationTimeRef.current = Date.now();
                    }
                } catch (error) {
                    console.error('Error handling window focus changed:', error);
                }
            }
        };

        // Initialize by loading saved data and getting the current active tab
        loadTabActivity();
        getActiveTab();

        // Add event listeners if chrome API is available for active tracking
        if (currentChrome && currentChrome.tabs && currentChrome.windows) {
            currentChrome.tabs.onActivated.addListener(handleTabActivated);
            currentChrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
        }

        // Cleanup function for when the component unmounts (e.g., popup closes)
        return () => {
            // Ensure to update the duration one last time for the currently active tab
            updatePreviousTabDuration();
            // Remove event listeners to prevent memory leaks and unnecessary operations
            if (currentChrome && currentChrome.tabs && currentChrome.windows) {
                currentChrome.tabs.onActivated.removeListener(handleTabActivated);
                currentChrome.windows.onFocusChanged.removeListener(handleWindowFocusChanged);
            }
        };
    }, [activeTabUrl]); // Dependency on activeTabUrl ensures updatePreviousTabDuration has the correct URL

    // Helper function to format milliseconds into a human-readable string (e.g., "1h 30m 5s")
    const formatDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
        if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60}s`); // Ensure at least seconds are shown

        return parts.join(' ');
    };

    // Render the UI of the extension's popup dashboard
    return (
        <div style={styles.container}>
            <h1 style={styles.header}>Productivity Monitor</h1>
            <div style={styles.currentTab}>
                <p style={styles.currentTabLabel}><strong>Current Active Tab:</strong></p>
                <p style={styles.currentUrl}>{activeTabUrl}</p>
            </div>
            <h2 style={styles.sectionHeader}>Activity Summary:</h2>
            {Object.keys(tabActivity).length === 0 ? (
                <p style={styles.noActivity}>No activity logged yet. Start browsing!</p>
            ) : (
                <ul style={styles.activityList}>
                    {Object.entries(tabActivity)
                        .sort(([, a], [, b]) => b - a) // Sort by duration in descending order (longest time first)
                        .map(([url, duration]) => (
                            <li key={url} style={styles.activityItem}>
                                <span style={styles.activityUrl}>{url}:</span>
                                <span style={styles.activityDuration}>{formatDuration(duration)}</span>
                            </li>
                        ))}
                </ul>
            )}
            <button
                onClick={() => {
                    setTabActivity({}); // Clear state
                    // Clear data from Chrome's local storage
                    if (currentChrome && currentChrome.storage) {
                        currentChrome.storage.local.set({ tabActivity: {} });
                    } else {
                        localStorage.removeItem('mockTabActivity'); // Clear mock storage for dev environment
                    }
                }}
                style={styles.clearButton}
            >
                Clear All Activity
            </button>
        </div>
    );
};

// Styles for the React components - defined as a JavaScript object
const styles = {
    container: {
        fontFamily: "'Inter', sans-serif",
        padding: '20px',
        width: '400px', // Fixed width for the extension popup
        backgroundColor: '#000000', // Black background
        borderRadius: '10px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)', // Adjusted shadow for dark background
        color: '#ffffff', // White text for general readability
        lineHeight: '1.6',
    },
    header: {
        fontSize: '24px',
        fontWeight: 'bold',
        marginBottom: '20px',
        color: '#4318ff', // Purple accent
        textAlign: 'center',
        borderBottom: '2px solid #333333', // Dark gray border for contrast
        paddingBottom: '10px',
    },
    currentTab: {
        backgroundColor: '#1a0d33', // Darker purple background for current tab section
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #4318ff', // Purple border
    },
    currentTabLabel: {
        color: '#ffffff', // White label for contrast
        margin: '0 0 5px 0', // Adjust margin
    },
    currentUrl: {
        wordBreak: 'break-all', // Ensures long URLs wrap correctly
        fontSize: '14px',
        color: '#b380ff', // Lighter purple for the URL for visibility
        fontWeight: '500',
        margin: '0', // Remove default paragraph margin
    },
    sectionHeader: {
        fontSize: '20px',
        fontWeight: 'bold',
        marginBottom: '15px',
        color: '#4318ff', // Purple accent
        borderBottom: '1px solid #333333', // Dark gray border
        paddingBottom: '5px',
    },
    noActivity: {
        fontStyle: 'italic',
        color: '#cccccc', // Light gray for visibility on black
        textAlign: 'center',
        padding: '20px 0',
    },
    activityList: {
        listStyleType: 'none', // Remove bullet points
        padding: '0',
        maxHeight: '300px', // Limits height and adds scrollbar if content overflows
        overflowY: 'auto',
        border: '1px solid #333333', // Dark gray border
        borderRadius: '8px',
        backgroundColor: '#1a1a1a', // Slightly lighter black for list background
    },
    activityItem: {
        display: 'flex', // Use flexbox for layout
        justifyContent: 'space-between', // Pushes URL and duration to ends
        alignItems: 'center', // Centers items vertically
        padding: '12px 15px',
        borderBottom: '1px solid #222222', // Even darker border between items
        backgroundColor: '#1a1a1a',
        transition: 'background-color 0.3s ease', // Smooth hover effect
        borderRadius: '8px',
        marginBottom: '5px', // Spacing between list items
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)', // Subtle shadow for depth
    },
    activityUrl: {
        flexGrow: '1', // Allows URL to take up available space
        marginRight: '10px',
        wordBreak: 'break-all',
        color: '#e0e0e0', // Light gray for URLs
        fontSize: '14px',
    },
    activityDuration: {
        fontWeight: '600',
        color: '#90ee90', // Light green for duration for good contrast
        minWidth: '60px', // Ensures duration column has minimum width
        textAlign: 'right',
        fontSize: '14px',
    },
    clearButton: {
        display: 'block',
        width: '100%',
        padding: '12px',
        marginTop: '20px',
        backgroundColor: '#660000', // Darker red for clear button
        color: 'white',
        border: '1px solid #990000', // Darker red border
        borderRadius: '8px',
        fontSize: '16px',
        cursor: 'pointer',
        transition: 'background-color 0.3s ease, transform 0.2s ease',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
        backgroundImage: 'linear-gradient(45deg, #660000, #4d0000)', // Darker gradient for aesthetic appeal
        '&:hover': { // Note: These pseudo-classes are for CSS-in-JS libraries like styled-components.
            // For plain React inline styles, you'd handle hover with onMouseEnter/onMouseLeave.
            // They are included here for illustrative purposes of desired effect.
            backgroundColor: '#4d0000', // Darker red on hover
            transform: 'translateY(-2px)', // Slight lift effect
        },
        '&:active': {
            transform: 'translateY(0)', // Push effect on click
        },
    },
};

export default App;
