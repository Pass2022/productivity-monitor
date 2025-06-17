const App = () => {
    // State to store the active tab's URL
    const [activeTabUrl, setActiveTabUrl] = useState('No active tab');
    // State to store the accumulated historical tab activity data
    const [tabActivity, setTabActivity] = useState({});
    // Ref to hold the ID of the currently active tab
    const activeTabIdRef = useRef(null);
    // Ref to hold the timestamp when the current tab became active (used for both historical and current duration)
    const tabActivationTimeRef = useRef(null);
    // State to store the duration of the *currently* active tab in real-time
    const [currentTabDuration, setCurrentTabDuration] = useState(0);

    // Function to safely access chrome API methods, or provide a mock
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
            if (!currentChrome || !currentChrome.tabs) {
                console.warn("Chrome tabs API not available, cannot get active tab.");
                return;
            }
            try {
                const tabs = await new Promise((resolve) => {
                    currentChrome.tabs.query({ active: true, currentWindow: true }, resolve);
                });
                if (tabs && tabs.length > 0) {
                    const tab = tabs[0];
                    activeTabIdRef.current = tab.id;
                    setActiveTabUrl(tab.url || 'Unknown URL');
                    tabActivationTimeRef.current = Date.now();
                    setCurrentTabDuration(0); // Reset current tab duration when a new tab is set
                }
            } catch (error) {
                console.error('Error getting active tab:', error);
            }
        };

        // Function to update the duration for the previously active tab (for historical record)
        const updatePreviousTabDuration = () => {
            if (activeTabIdRef.current && tabActivationTimeRef.current && currentChrome && currentChrome.storage) {
                const duration = Date.now() - tabActivationTimeRef.current;
                setTabActivity(prevActivity => {
                    const newActivity = { ...prevActivity };
                    const url = activeTabUrl;

                    if (newActivity[url]) {
                        newActivity[url] += duration;
                    } else {
                        newActivity[url] = duration;
                    }
                    currentChrome.storage.local.set({ tabActivity: newActivity });
                    return newActivity;
                });
            }
        };

        // Listener for when a tab becomes active (user switches tabs)
        const handleTabActivated = async (activeInfo) => {
            if (!currentChrome || !currentChrome.tabs) return;

            updatePreviousTabDuration(); // Update historical data for the old tab

            try {
                const tab = await new Promise((resolve) => {
                    currentChrome.tabs.get(activeInfo.tabId, resolve);
                });
                if (tab) {
                    activeTabIdRef.current = tab.id;
                    setActiveTabUrl(tab.url || 'Unknown URL');
                    tabActivationTimeRef.current = Date.now();
                    setCurrentTabDuration(0); // Reset current tab duration for the new active tab
                }
            } catch (error) {
                console.error('Error handling tab activated:', error);
            }
        };

        // Listener for when the browser window focus changes (e.g., user switches to another application)
        const handleWindowFocusChanged = async (windowId) => {
            if (!currentChrome || !currentChrome.tabs || !currentChrome.windows) return;

            if (windowId === currentChrome.windows.WINDOW_ID_NONE) {
                updatePreviousTabDuration(); // Update historical data
                activeTabIdRef.current = null;
                tabActivationTimeRef.current = null;
                setCurrentTabDuration(0); // Reset current tab duration
                setActiveTabUrl('No active tab (window unfocused)');
            } else {
                try {
                    const tabs = await new Promise((resolve) => {
                        currentChrome.tabs.query({ active: true, windowId: windowId }, resolve);
                    });
                    if (tabs && tabs.length > 0) {
                        const tab = tabs[0];
                        activeTabIdRef.current = tab.id;
                        setActiveTabUrl(tab.url || 'Unknown URL');
                        tabActivationTimeRef.current = Date.now();
                        setCurrentTabDuration(0); // Reset current tab duration
                    }
                } catch (error) {
                    console.error('Error handling window focus changed:', error);
                }
            }
        };

        // Set up interval to update the current tab's duration every second
        const intervalId = setInterval(() => {
            if (tabActivationTimeRef.current) {
                setCurrentTabDuration(Date.now() - tabActivationTimeRef.current);
            }
        }, 1000); // Update every 1 second

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
            clearInterval(intervalId); // Clear the interval when component unmounts
            updatePreviousTabDuration(); // Ensure final historical update
            if (currentChrome && currentChrome.tabs && currentChrome.windows) {
                currentChrome.tabs.onActivated.removeListener(handleTabActivated);
                currentChrome.windows.onFocusChanged.removeListener(handleWindowFocusChanged);
            }
        };
    }, [activeTabUrl]); // Dependency ensures effect re-runs when activeTabUrl changes to reset timer

    // Helper function to format milliseconds into a human-readable string
    const formatDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
        if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60}s`);

        return parts.join(' ');
    };

    // Render the UI of the extension's popup dashboard
    return (
        <div style={styles.container}>
            <h1 style={styles.header}>Productivity Monitor</h1>
            <div style={styles.currentTab}>
                <p style={styles.currentTabLabel}><strong>Current Active Tab:</strong></p>
                <p style={styles.currentUrl}>{activeTabUrl}</p>
                <p style={styles.currentTabTimer}>
                    Duration: <span style={styles.currentTabDurationValue}>{formatDuration(currentTabDuration)}</span>
                </p>
            </div>
            <h2 style={styles.sectionHeader}>Activity Summary:</h2>
            {Object.keys(tabActivity).length === 0 ? (
                <p style={styles.noActivity}>No activity logged yet. Start browsing!</p>
            ) : (
                <ul style={styles.activityList}>
                    {Object.entries(tabActivity)
                        .sort(([, a], [, b]) => b - a) // Sort by duration in descending order
                        .map(([url, duration]) => (
                            <li key={url} style={styles.activityItem}>
                                <span style={styles.activityUrl}>{url}:</span>
                                <span style={styles.activityDuration}>{formatDuration(duration)}</span>
                            </li>
                        ))}
                </ul>
            )}
            {/* The "Clear All Activity" button has been removed as per your request */}
        </div>
    );
};

// Styles for the React components
const styles = {
    container: {
        fontFamily: "'Inter', sans-serif",
        padding: '20px',
        width: '400px',
        backgroundColor: '#000000',
        borderRadius: '10px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        color: '#ffffff',
        lineHeight: '1.6',
    },
    header: {
        fontSize: '24px',
        fontWeight: 'bold',
        marginBottom: '20px',
        color: '#4318ff',
        textAlign: 'center',
        borderBottom: '2px solid #333333',
        paddingBottom: '10px',
    },
    currentTab: {
        backgroundColor: '#1a0d33',
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #4318ff',
    },
    currentTabLabel: {
        color: '#ffffff',
        margin: '0 0 5px 0',
    },
    currentUrl: {
        wordBreak: 'break-all',
        fontSize: '14px',
        color: '#b380ff',
        fontWeight: '500',
        margin: '0',
    },
    currentTabTimer: {
        fontSize: '16px',
        color: '#ffffff',
        marginTop: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontWeight: 'bold',
    },
    currentTabDurationValue: {
        color: '#90ee90', // Light green for duration
        fontSize: '18px',
        marginLeft: '10px',
    },
    sectionHeader: {
        fontSize: '20px',
        fontWeight: 'bold',
        marginBottom: '15px',
        color: '#4318ff',
        borderBottom: '1px solid #333333',
        paddingBottom: '5px',
    },
    noActivity: {
        fontStyle: 'italic',
        color: '#cccccc',
        textAlign: 'center',
        padding: '20px 0',
    },
    activityList: {
        listStyleType: 'none',
        padding: '0',
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid #333333',
        borderRadius: '8px',
        backgroundColor: '#1a1a1a',
    },
    activityItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 15px',
        borderBottom: '1px solid #222222',
        backgroundColor: '#1a1a1a',
        transition: 'background-color 0.3s ease',
        borderRadius: '8px',
        marginBottom: '5px',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    },
    activityUrl: {
        flexGrow: '1',
        marginRight: '10px',
        wordBreak: 'break-all',
        color: '#e0e0e0',
        fontSize: '14px',
    },
    activityDuration: {
        fontWeight: '600',
        color: '#90ee90',
        minWidth: '60px',
        textAlign: 'right',
        fontSize: '14px',
    },
    // The clearButton style is no longer needed as the button is removed
};

export default App;
