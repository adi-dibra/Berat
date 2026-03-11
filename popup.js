(function () {
  "use strict";

  const THRESHOLD_OPTIONS = [2, 3, 4, 5];
  const DEFAULT_THRESHOLD = 3;

  const SETTINGS_KEY_TAB_MIN_MATCHES = "tabMinMatches";
  const SETTINGS_KEY_BOOKMARK_MIN_MATCHES = "bookmarkMinMatches";
  const SETTINGS_KEY_COLLAPSE_ON_CREATE = "collapseOnCreate";
  const SETTINGS_KEY_OPEN_BOOKMARKS_IN_BACKGROUND = "openBookmarksInBackground";
  const SETTINGS_KEY_BOOKMARK_FOLDER_ID = "bookmarkFolderId";
  const LEGACY_SETTINGS_KEY_MIN_DOMAIN_MATCHES = "minDomainMatches";

  const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "ftp:", "file:"]);
  const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "edu.au", "asn.au",
    "co.jp", "ne.jp", "or.jp", "com.br", "com.tr", "co.nz", "com.mx", "com.sg", "com.hk",
    "com.tw", "co.in", "firm.in", "net.in", "org.in", "com.cn", "net.cn", "org.cn"
  ]);
  const COMMON_COUNTRY_SLD = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "mil"]);
  const GROUP_COLOR_PALETTE = ["blue", "cyan", "green", "orange", "pink", "purple", "red", "yellow"];

  const state = {
    tabMinMatches: DEFAULT_THRESHOLD,
    bookmarkMinMatches: DEFAULT_THRESHOLD,
    collapseOnCreate: false,
    openBookmarksInBackground: true,
    bookmarkFolderId: "",
    activeView: "tabs",
    busy: false,
    tabDomainCounts: [],
    bookmarkDomainCounts: [],
    bookmarkFolders: [],
    groups: [],
    folderTitleById: {}
  };

  const ui = {
    saveTabRulesButton: null,
    saveBookmarkRulesButton: null,
    refreshGroupsButton: null,
    refreshBookmarkFoldersButton: null,
    tabsThresholdSlider: null,
    bookmarksThresholdSlider: null,
    collapseNewGroupsCheckbox: null,
    openBookmarksBackgroundCheckbox: null,
    bookmarkFolderPicker: null,
    tabsRuleSummary: null,
    bookmarksRuleSummary: null,
    groupList: null,
    bookmarkFolderList: null,
    status: null
  };

  document.addEventListener("DOMContentLoaded", function () {
    void initializePopup();
  });

  async function initializePopup() {
    cacheElements();
    wireEvents();
    setActiveView("tabs");

    if (!hasChromeExtensionApis()) {
      setStatus("Chrome extension APIs are unavailable. Load this via chrome://extensions.", "error");
      setControlsDisabled(true);
      return;
    }

    try {
      await loadBookmarkFolderPicker();
      await loadSettings();
      syncSettingsInputs();
      await refreshOverview();
      setStatus("Ready.", "success");
    } catch (error) {
      setStatus(toErrorMessage(error), "error");
    }
  }

  function cacheElements() {
    ui.saveTabRulesButton = document.getElementById("save-tab-rules");
    ui.saveBookmarkRulesButton = document.getElementById("save-bookmark-rules");
    ui.refreshGroupsButton = document.getElementById("refresh-groups");
    ui.refreshBookmarkFoldersButton = document.getElementById("refresh-bookmark-folders");
    ui.tabsThresholdSlider = document.getElementById("tabs-threshold-slider");
    ui.bookmarksThresholdSlider = document.getElementById("bookmarks-threshold-slider");
    ui.collapseNewGroupsCheckbox = document.getElementById("collapse-new-groups");
    ui.openBookmarksBackgroundCheckbox = document.getElementById("open-bookmarks-background");
    ui.bookmarkFolderPicker = document.getElementById("bookmark-folder-picker");
    ui.tabsRuleSummary = document.getElementById("tabs-rule-summary");
    ui.bookmarksRuleSummary = document.getElementById("bookmarks-rule-summary");
    ui.groupList = document.getElementById("group-list");
    ui.bookmarkFolderList = document.getElementById("bookmark-folder-list");
    ui.status = document.getElementById("status");
  }

  function wireEvents() {
    const viewButtons = document.querySelectorAll("[data-view]");
    viewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const view = button.getAttribute("data-view");
        setActiveView(view === "bookmarks" ? "bookmarks" : "tabs");
      });
    });

    ui.tabsThresholdSlider.addEventListener("input", function (event) {
      state.tabMinMatches = sliderIndexToThreshold(Number(event.target.value));
      renderTabsRuleSummary();
    });

    ui.bookmarksThresholdSlider.addEventListener("input", function (event) {
      state.bookmarkMinMatches = sliderIndexToThreshold(Number(event.target.value));
      renderBookmarksRuleSummary();
    });

    ui.collapseNewGroupsCheckbox.addEventListener("change", function (event) {
      state.collapseOnCreate = Boolean(event.target.checked);
    });

    ui.openBookmarksBackgroundCheckbox.addEventListener("change", function (event) {
      state.openBookmarksInBackground = Boolean(event.target.checked);
    });

    ui.bookmarkFolderPicker.addEventListener("change", function (event) {
      state.bookmarkFolderId = String(event.target.value || "");
      void runAction(
        "Loading bookmark folder",
        async function () {
          await refreshBookmarkOverview();
          await saveSettings();
        },
        function () {
          return "Bookmark folder scope updated.";
        },
        false
      );
    });

    ui.saveTabRulesButton.addEventListener("click", function () {
      void runAction(
        "Saving tab rules",
        saveSettings,
        function () {
          return "Tab rules saved.";
        },
        false
      );
    });

    ui.saveBookmarkRulesButton.addEventListener("click", function () {
      void runAction(
        "Saving bookmark rules",
        saveSettings,
        function () {
          return "Bookmark rules saved.";
        },
        false
      );
    });

    ui.refreshGroupsButton.addEventListener("click", function () {
      void runAction(
        "Refreshing tab data",
        refreshOverview,
        function () {
          return "Tab data refreshed.";
        },
        false
      );
    });

    ui.refreshBookmarkFoldersButton.addEventListener("click", function () {
      void runAction(
        "Refreshing bookmark folders",
        refreshBookmarkOverview,
        function () {
          return "Bookmark folders refreshed.";
        },
        false
      );
    });

    const actionButtons = document.querySelectorAll("[data-action]");
    actionButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const action = button.getAttribute("data-action");
        void handleAction(action);
      });
    });
  }

  function setActiveView(nextView) {
    state.activeView = nextView === "bookmarks" ? "bookmarks" : "tabs";

    const tabsButton = document.getElementById("view-tab-tabs");
    const bookmarksButton = document.getElementById("view-tab-bookmarks");
    const tabsPanel = document.getElementById("view-tabs");
    const bookmarksPanel = document.getElementById("view-bookmarks");

    const tabsActive = state.activeView === "tabs";
    tabsButton.classList.toggle("is-active", tabsActive);
    tabsButton.setAttribute("aria-selected", tabsActive ? "true" : "false");
    bookmarksButton.classList.toggle("is-active", !tabsActive);
    bookmarksButton.setAttribute("aria-selected", tabsActive ? "false" : "true");
    tabsPanel.classList.toggle("is-active", tabsActive);
    bookmarksPanel.classList.toggle("is-active", !tabsActive);
  }

  async function handleAction(action) {
    if (!action) {
      return;
    }

    if (action === "group-tabs") {
      await runAction(
        "Grouping tabs",
        function () {
          return groupTabsByRootDomain(state.tabMinMatches, state.collapseOnCreate);
        },
        function (result) {
          if (result.groupedDomains === 0) {
            return "No domains met the " + thresholdLabel(state.tabMinMatches) + " threshold.";
          }
          return "Grouped " + result.tabsGrouped + " tabs into " + result.groupedDomains + " root-domain groups.";
        }
      );
      return;
    }

    if (action === "group-bookmarks") {
      await runAction(
        "Grouping bookmarks",
        function () {
          return groupBookmarksByRootDomain(state.bookmarkFolderId, state.bookmarkMinMatches);
        },
        function (result) {
          if (result.groupedDomains === 0) {
            return "No bookmark domains met the " + thresholdLabel(state.bookmarkMinMatches) + " threshold.";
          }
          return "Grouped bookmarks into " + result.groupedDomains + " domain folders and moved " + result.movedBookmarks + " bookmarks.";
        }
      );
      return;
    }

    if (action === "dedupe-tabs") {
      await runAction(
        "Removing duplicate tabs",
        removeDuplicateTabs,
        function (result) {
          if (result.removed === 0) {
            return "No duplicate tabs found in " + result.scanned + " scanned tabs.";
          }
          return "Removed " + result.removed + " duplicate tabs.";
        }
      );
      return;
    }

    if (action === "dedupe-root-tabs") {
      await runAction(
        "Removing duplicate tab root domains",
        removeDuplicateTabsByRootDomain,
        function (result) {
          if (result.removed === 0) {
            return "No duplicate root domains found in " + result.scanned + " scanned tabs.";
          }
          return "Removed " + result.removed + " tabs by root-domain dedupe.";
        }
      );
      return;
    }

    if (action === "dedupe-bookmarks") {
      await runAction(
        "Removing duplicate bookmarks",
        function () {
          return removeDuplicateBookmarks(state.bookmarkFolderId);
        },
        function (result) {
          if (result.removed === 0) {
            return "No duplicate bookmarks found in " + result.scanned + " scanned bookmarks.";
          }
          return "Removed " + result.removed + " duplicate bookmarks.";
        }
      );
      return;
    }

    if (action === "dedupe-root-bookmarks") {
      await runAction(
        "Removing duplicate bookmark root domains",
        function () {
          return removeDuplicateBookmarksByRootDomain(state.bookmarkFolderId);
        },
        function (result) {
          if (result.removed === 0) {
            return "No duplicate bookmark root domains found in " + result.scanned + " scanned bookmarks.";
          }
          return "Removed " + result.removed + " bookmarks by root-domain dedupe.";
        }
      );
      return;
    }

    if (action === "bookmark-tabs") {
      await runAction(
        "Bookmarking open tabs",
        function () {
          return bookmarkAllOpenTabs(state.bookmarkFolderId);
        },
        function (result) {
          if (result.created === 0) {
            return "No bookmarkable tabs found in the current window.";
          }
          return 'Saved ' + result.created + ' tabs to "' + result.folderName + '".';
        }
      );
      return;
    }

    if (action === "open-bookmarks") {
      await runAction(
        "Opening bookmarks as tabs",
        function () {
          return openAllBookmarksAsTabs(state.openBookmarksInBackground, state.bookmarkFolderId);
        },
        function (result) {
          if (result.opened === 0) {
            return "No bookmark URLs found in the selected folder.";
          }
          const groupingNote = result.groupedSets > 0 ? " and grouped " + result.groupedSets + " folder sets" : "";
          return "Opened " + result.opened + " bookmarks as " + (state.openBookmarksInBackground ? "background" : "foreground") + " tabs" + groupingNote + ".";
        }
      );
      return;
    }

    if (action === "ungroup-bookmarks") {
      await runAction(
        "Ungrouping bookmarks",
        function () {
          return ungroupBookmarksByDomain(state.bookmarkFolderId);
        },
        function (result) {
          if (result.foldersCleared === 0) {
            return "No domain folders found to ungroup.";
          }
          return "Ungrouped " + result.movedBookmarks + " bookmarks from " + result.foldersCleared + " folders.";
        }
      );
      return;
    }

    if (action === "ungroup-tabs") {
      await runAction(
        "Ungrouping tabs",
        ungroupAllTabs,
        function (result) {
          if (result.tabsUngrouped === 0) {
            return "No grouped tabs found in this window.";
          }
          return "Ungrouped " + result.tabsUngrouped + " tabs across " + result.groupsCleared + " groups.";
        }
      );
      return;
    }

    if (action === "collapse-all") {
      await runAction(
        "Collapsing groups",
        function () {
          return setAllGroupsCollapsed(true);
        },
        function (count) {
          return count === 0 ? "No groups found to collapse." : "Collapsed " + count + " groups.";
        }
      );
      return;
    }

    if (action === "expand-all") {
      await runAction(
        "Expanding groups",
        function () {
          return setAllGroupsCollapsed(false);
        },
        function (count) {
          return count === 0 ? "No groups found to expand." : "Expanded " + count + " groups.";
        }
      );
    }
  }

  async function runAction(startMessage, actionFn, successMessageFn, refreshAfterAction = true) {
    if (state.busy) {
      return;
    }

    state.busy = true;
    setControlsDisabled(true);
    setStatus(startMessage + "...", "info");

    try {
      const result = await actionFn();
      if (refreshAfterAction) {
        await refreshOverview();
      }
      setStatus(successMessageFn(result), "success");
    } catch (error) {
      setStatus(toErrorMessage(error), "error");
    } finally {
      state.busy = false;
      setControlsDisabled(false);
    }
  }

  function setControlsDisabled(disabled) {
    const controls = document.querySelectorAll("button, input, select");
    controls.forEach(function (element) {
      element.disabled = disabled;
    });
  }

  function hasChromeExtensionApis() {
    return (
      typeof chrome !== "undefined" &&
      chrome.tabs &&
      chrome.tabGroups &&
      chrome.bookmarks &&
      chrome.storage
    );
  }

  function sliderIndexToThreshold(index) {
    const i = Math.max(0, Math.min(THRESHOLD_OPTIONS.length - 1, Number(index) || 0));
    return THRESHOLD_OPTIONS[i];
  }

  function thresholdToSliderIndex(threshold) {
    const safe = clampThreshold(threshold);
    return THRESHOLD_OPTIONS.indexOf(safe);
  }

  function clampThreshold(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_THRESHOLD;
    }
    if (numeric <= 2) {
      return 2;
    }
    if (numeric === 3) {
      return 3;
    }
    if (numeric === 4) {
      return 4;
    }
    return 5;
  }

  function thresholdLabel(threshold) {
    return threshold >= 5 ? "5+" : String(threshold);
  }

  async function loadSettings() {
    const defaults = {};
    defaults[SETTINGS_KEY_TAB_MIN_MATCHES] = DEFAULT_THRESHOLD;
    defaults[SETTINGS_KEY_BOOKMARK_MIN_MATCHES] = DEFAULT_THRESHOLD;
    defaults[SETTINGS_KEY_COLLAPSE_ON_CREATE] = false;
    defaults[SETTINGS_KEY_OPEN_BOOKMARKS_IN_BACKGROUND] = true;
    defaults[SETTINGS_KEY_BOOKMARK_FOLDER_ID] = "";
    defaults[LEGACY_SETTINGS_KEY_MIN_DOMAIN_MATCHES] = DEFAULT_THRESHOLD;

    const stored = await chrome.storage.sync.get(defaults);
    const legacyThreshold = clampThreshold(stored[LEGACY_SETTINGS_KEY_MIN_DOMAIN_MATCHES]);

    state.tabMinMatches = clampThreshold(stored[SETTINGS_KEY_TAB_MIN_MATCHES] || legacyThreshold);
    state.bookmarkMinMatches = clampThreshold(stored[SETTINGS_KEY_BOOKMARK_MIN_MATCHES] || legacyThreshold);
    state.collapseOnCreate = Boolean(stored[SETTINGS_KEY_COLLAPSE_ON_CREATE]);
    state.openBookmarksInBackground = Boolean(stored[SETTINGS_KEY_OPEN_BOOKMARKS_IN_BACKGROUND]);

    const preferredFolderId = String(stored[SETTINGS_KEY_BOOKMARK_FOLDER_ID] || "");
    state.bookmarkFolderId = resolvePreferredFolderId(preferredFolderId);
  }

  async function saveSettings() {
    const payload = {};
    payload[SETTINGS_KEY_TAB_MIN_MATCHES] = clampThreshold(state.tabMinMatches);
    payload[SETTINGS_KEY_BOOKMARK_MIN_MATCHES] = clampThreshold(state.bookmarkMinMatches);
    payload[SETTINGS_KEY_COLLAPSE_ON_CREATE] = Boolean(state.collapseOnCreate);
    payload[SETTINGS_KEY_OPEN_BOOKMARKS_IN_BACKGROUND] = Boolean(state.openBookmarksInBackground);
    payload[SETTINGS_KEY_BOOKMARK_FOLDER_ID] = String(state.bookmarkFolderId || "");
    await chrome.storage.sync.set(payload);
  }

  function syncSettingsInputs() {
    ui.tabsThresholdSlider.value = String(thresholdToSliderIndex(state.tabMinMatches));
    ui.bookmarksThresholdSlider.value = String(thresholdToSliderIndex(state.bookmarkMinMatches));
    ui.collapseNewGroupsCheckbox.checked = state.collapseOnCreate;
    ui.openBookmarksBackgroundCheckbox.checked = state.openBookmarksInBackground;
    ui.bookmarkFolderPicker.value = state.bookmarkFolderId;
  }

  async function loadBookmarkFolderPicker() {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const folders = [];
    const titleById = {};

    function walk(nodes, depth) {
      nodes.forEach(function (node) {
        if (node.url) {
          return;
        }

        if (node.id !== "0") {
          const title = node.title || "Untitled Folder";
          folders.push({ id: node.id, title: title, depth: depth });
          titleById[node.id] = title;
        }

        if (node.children && node.children.length > 0) {
          walk(node.children, depth + 1);
        }
      });
    }

    walk(root.children || [], 0);

    ui.bookmarkFolderPicker.textContent = "";
    folders.forEach(function (folder) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = indentation(folder.depth) + folder.title;
      ui.bookmarkFolderPicker.appendChild(option);
    });

    state.folderTitleById = titleById;
    state.bookmarkFolderId = resolvePreferredFolderId(state.bookmarkFolderId);
    ui.bookmarkFolderPicker.value = state.bookmarkFolderId;
  }

  function indentation(depth) {
    let prefix = "";
    for (let i = 0; i < depth; i += 1) {
      prefix += "  ";
    }
    return prefix ? prefix + "↳ " : "";
  }

  function resolvePreferredFolderId(preferredId) {
    const options = ui.bookmarkFolderPicker.options;
    if (options.length === 0) {
      return "";
    }

    if (preferredId) {
      for (let i = 0; i < options.length; i += 1) {
        if (options[i].value === preferredId) {
          return preferredId;
        }
      }
    }

    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === "1") {
        return "1";
      }
    }

    return options[0].value;
  }

  async function refreshOverview() {
    const results = await Promise.all([
      getDomainCountsForCurrentWindow(),
      getCurrentWindowGroups(),
      getBookmarkDomainCountsForFolder(state.bookmarkFolderId),
      getBookmarkFolderSummaries(state.bookmarkFolderId)
    ]);

    state.tabDomainCounts = results[0];
    state.groups = results[1];
    state.bookmarkDomainCounts = results[2];
    state.bookmarkFolders = results[3];

    renderTabsRuleSummary();
    renderBookmarksRuleSummary();
    renderGroupList();
    renderBookmarkFolderList();
  }

  async function refreshBookmarkOverview() {
    const results = await Promise.all([
      getBookmarkDomainCountsForFolder(state.bookmarkFolderId),
      getBookmarkFolderSummaries(state.bookmarkFolderId)
    ]);
    state.bookmarkDomainCounts = results[0];
    state.bookmarkFolders = results[1];
    renderBookmarksRuleSummary();
    renderBookmarkFolderList();
  }

  function renderTabsRuleSummary() {
    if (state.tabDomainCounts.length === 0) {
      ui.tabsRuleSummary.textContent = "No supported tab URLs found in this window.";
      return;
    }

    const eligibleCount = state.tabDomainCounts.filter(function (entry) {
      return entry.count >= state.tabMinMatches;
    }).length;

    ui.tabsRuleSummary.textContent =
      eligibleCount + " of " + state.tabDomainCounts.length + " root domains meet " + thresholdLabel(state.tabMinMatches) + ".";
  }

  function renderBookmarksRuleSummary() {
    const folderTitle = state.folderTitleById[state.bookmarkFolderId] || "selected folder";

    if (state.bookmarkDomainCounts.length === 0) {
      ui.bookmarksRuleSummary.textContent = 'No bookmark URLs found in "' + folderTitle + '".';
      return;
    }

    const eligibleCount = state.bookmarkDomainCounts.filter(function (entry) {
      return entry.count >= state.bookmarkMinMatches;
    }).length;

    ui.bookmarksRuleSummary.textContent =
      eligibleCount +
      " of " +
      state.bookmarkDomainCounts.length +
      ' root domains in "' +
      folderTitle +
      '" meet ' +
      thresholdLabel(state.bookmarkMinMatches) +
      ".";
  }

  function renderGroupList() {
    ui.groupList.textContent = "";

    if (state.groups.length === 0) {
      ui.groupList.appendChild(createEmptyRow("No tab groups currently exist in this window."));
      return;
    }

    state.groups.forEach(function (group) {
      const row = document.createElement("li");
      row.className = "group-item";

      const meta = document.createElement("div");
      meta.className = "group-meta";

      const color = document.createElement("span");
      color.className = "group-color " + normalizeGroupColor(group.color);

      const text = document.createElement("div");
      text.className = "group-text";

      const title = document.createElement("div");
      title.className = "group-name";
      title.textContent = group.title;

      const size = document.createElement("div");
      size.className = "group-size";
      size.textContent = group.size + " tabs";

      text.appendChild(title);
      text.appendChild(size);
      meta.appendChild(color);
      meta.appendChild(text);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn btn-ghost";
      toggle.textContent = group.collapsed ? "Expand" : "Collapse";
      toggle.addEventListener("click", function () {
        void runAction(
          group.collapsed ? "Expanding group" : "Collapsing group",
          function () {
            return setGroupCollapsed(group.id, !group.collapsed);
          },
          function () {
            return (group.collapsed ? "Expanded " : "Collapsed ") + '"' + group.title + '".';
          }
        );
      });

      row.appendChild(meta);
      row.appendChild(toggle);
      ui.groupList.appendChild(row);
    });
  }

  function renderBookmarkFolderList() {
    ui.bookmarkFolderList.textContent = "";

    if (state.bookmarkFolders.length === 0) {
      ui.bookmarkFolderList.appendChild(createEmptyRow("No subfolders found in the selected bookmark folder."));
      return;
    }

    state.bookmarkFolders.forEach(function (folder) {
      const row = document.createElement("li");
      row.className = "group-item";

      const meta = document.createElement("div");
      meta.className = "group-meta";

      const color = document.createElement("span");
      color.className = "group-color blue";

      const text = document.createElement("div");
      text.className = "group-text";

      const title = document.createElement("div");
      title.className = "group-name";
      title.textContent = folder.title;

      const size = document.createElement("div");
      size.className = "group-size";
      size.textContent = folder.bookmarkCount + " bookmarks";

      const badge = document.createElement("span");
      badge.className = "folder-pill";
      badge.textContent = folder.childFolderCount + " folders";

      text.appendChild(title);
      text.appendChild(size);
      meta.appendChild(color);
      meta.appendChild(text);
      meta.appendChild(badge);

      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.className = "btn btn-ghost";
      useButton.textContent = "Use";
      useButton.addEventListener("click", function () {
        state.bookmarkFolderId = folder.id;
        ui.bookmarkFolderPicker.value = folder.id;
        void runAction(
          "Switching bookmark folder",
          async function () {
            await saveSettings();
            await refreshBookmarkOverview();
          },
          function () {
            return "Bookmark folder changed to \"" + folder.title + "\".";
          },
          false
        );
      });

      row.appendChild(meta);
      row.appendChild(useButton);
      ui.bookmarkFolderList.appendChild(row);
    });
  }

  function createEmptyRow(text) {
    const row = document.createElement("li");
    row.className = "empty-row";
    row.textContent = text;
    return row;
  }

  function normalizeGroupColor(color) {
    const valid = ["blue", "cyan", "green", "orange", "pink", "purple", "red", "yellow", "grey"];
    return valid.indexOf(color) >= 0 ? color : "grey";
  }

  function setStatus(message, kind) {
    ui.status.textContent = message;
    ui.status.className = "status status-" + (kind || "info");
  }

  function toErrorMessage(error) {
    if (error && typeof error.message === "string") {
      return error.message;
    }
    return "Unexpected error while running this action.";
  }

  function isSupportedUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return SUPPORTED_PROTOCOLS.has(parsed.protocol);
    } catch {
      return false;
    }
  }

  function normalizeUrl(rawUrl) {
    if (!isSupportedUrl(rawUrl)) {
      return null;
    }

    try {
      const parsed = new URL(rawUrl);
      parsed.hash = "";

      if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
        parsed.port = "";
      }

      const host = parsed.hostname.toLowerCase() + (parsed.port ? ":" + parsed.port : "");
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      const search = parsed.search || "";

      return parsed.protocol + "//" + host + pathname + search;
    } catch {
      return null;
    }
  }

  function isIpAddress(hostname) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      return true;
    }
    return hostname.indexOf(":") >= 0;
  }

  function getRootDomain(rawUrl) {
    if (!isSupportedUrl(rawUrl)) {
      return null;
    }

    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();
      if (!hostname) {
        return null;
      }

      if (hostname === "localhost" || isIpAddress(hostname)) {
        return hostname;
      }

      const segments = hostname.split(".").filter(Boolean);
      if (segments.length <= 2) {
        return hostname;
      }

      const suffix2 = segments.slice(-2).join(".");
      if (COMMON_SECOND_LEVEL_SUFFIXES.has(suffix2) && segments.length >= 3) {
        return segments.slice(-3).join(".");
      }

      const lastSegment = segments[segments.length - 1];
      const secondLastSegment = segments[segments.length - 2];
      if (
        lastSegment &&
        lastSegment.length === 2 &&
        secondLastSegment &&
        COMMON_COUNTRY_SLD.has(secondLastSegment) &&
        segments.length >= 3
      ) {
        return segments.slice(-3).join(".");
      }

      return segments.slice(-2).join(".");
    } catch {
      return null;
    }
  }

  function createDomainMapFromTabs(tabs) {
    const domainMap = new Map();

    tabs.forEach(function (tab) {
      if (!tab || tab.id === undefined || !tab.url) {
        return;
      }

      const domain = getRootDomain(tab.url);
      if (!domain) {
        return;
      }

      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(tab);
    });

    domainMap.forEach(function (domainTabs, domain) {
      domainTabs.sort(function (a, b) {
        return (a.index || 0) - (b.index || 0);
      });
      domainMap.set(domain, domainTabs);
    });

    return domainMap;
  }

  function createDomainMapFromBookmarks(bookmarks) {
    const domainMap = new Map();

    bookmarks.forEach(function (bookmark) {
      if (!bookmark.url) {
        return;
      }

      const domain = getRootDomain(bookmark.url);
      if (!domain) {
        return;
      }

      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(bookmark);
    });

    return domainMap;
  }

  function sortDomainEntries(entries) {
    entries.sort(function (a, b) {
      if (b[1].length !== a[1].length) {
        return b[1].length - a[1].length;
      }
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }

  function pickGroupColor(domain) {
    let hash = 0;
    for (let i = 0; i < domain.length; i += 1) {
      hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
    }
    return GROUP_COLOR_PALETTE[hash % GROUP_COLOR_PALETTE.length];
  }

  async function getDomainCountsForCurrentWindow() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const map = createDomainMapFromTabs(tabs);
    const counts = [];

    map.forEach(function (tabList, domain) {
      counts.push({ domain: domain, count: tabList.length });
    });

    counts.sort(function (a, b) {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.domain.localeCompare(b.domain);
    });

    return counts;
  }

  async function getCurrentWindowGroups() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupSizes = new Map();

    tabs.forEach(function (tab) {
      if (tab.groupId !== undefined && tab.groupId >= 0) {
        groupSizes.set(tab.groupId, (groupSizes.get(tab.groupId) || 0) + 1);
      }
    });

    const groupEntries = Array.from(groupSizes.entries());
    const summaries = await Promise.all(
      groupEntries.map(async function (entry) {
        const groupId = entry[0];
        const size = entry[1];
        const group = await chrome.tabGroups.get(groupId);
        return {
          id: groupId,
          title: group.title || "Group " + groupId,
          color: group.color || "grey",
          collapsed: Boolean(group.collapsed),
          size: size
        };
      })
    );

    summaries.sort(function (a, b) {
      if (b.size !== a.size) {
        return b.size - a.size;
      }
      return a.title.localeCompare(b.title);
    });

    return summaries;
  }

  async function groupTabsByRootDomain(minMatches, collapseGroups) {
    const threshold = clampThreshold(minMatches);
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const domainMap = createDomainMapFromTabs(tabs);

    const candidates = sortDomainEntries(
      Array.from(domainMap.entries()).filter(function (entry) {
        return entry[1].length >= threshold;
      })
    );

    if (candidates.length === 0) {
      return { groupedDomains: 0, tabsGrouped: 0 };
    }

    const existingGroupedTabIds = tabs
      .filter(function (tab) {
        return tab.id !== undefined && tab.groupId !== undefined && tab.groupId >= 0;
      })
      .map(function (tab) {
        return tab.id;
      });

    if (existingGroupedTabIds.length > 0) {
      await chrome.tabs.ungroup(existingGroupedTabIds);
    }

    let insertionIndex = 0;
    for (const candidate of candidates) {
      const tabIds = candidate[1]
        .map(function (tab) {
          return tab.id;
        })
        .filter(function (id) {
          return id !== undefined;
        });

      if (tabIds.length > 0) {
        await chrome.tabs.move(tabIds, { index: insertionIndex });
        insertionIndex += tabIds.length;
      }
    }

    let groupedDomains = 0;
    let tabsGrouped = 0;

    for (const candidate of candidates) {
      const domain = candidate[0];
      const tabIds = candidate[1]
        .map(function (tab) {
          return tab.id;
        })
        .filter(function (id) {
          return id !== undefined;
        });

      if (tabIds.length < threshold) {
        continue;
      }

      const groupId = await chrome.tabs.group({ tabIds: tabIds });
      await chrome.tabGroups.update(groupId, {
        title: domain,
        color: pickGroupColor(domain),
        collapsed: Boolean(collapseGroups)
      });

      groupedDomains += 1;
      tabsGrouped += tabIds.length;
    }

    return { groupedDomains: groupedDomains, tabsGrouped: tabsGrouped };
  }

  async function removeDuplicateTabs() {
    const tabs = await chrome.tabs.query({});
    const seen = new Set();
    const duplicateIds = [];

    tabs.forEach(function (tab) {
      if (!tab.url || tab.id === undefined) {
        return;
      }

      const normalized = normalizeUrl(tab.url);
      if (!normalized) {
        return;
      }

      if (seen.has(normalized)) {
        duplicateIds.push(tab.id);
      } else {
        seen.add(normalized);
      }
    });

    if (duplicateIds.length > 0) {
      await chrome.tabs.remove(duplicateIds);
    }

    return { removed: duplicateIds.length, scanned: tabs.length };
  }

  async function removeDuplicateTabsByRootDomain() {
    const tabs = await chrome.tabs.query({});
    const seenRoots = new Set();
    const duplicateIds = [];

    tabs.forEach(function (tab) {
      if (!tab.url || tab.id === undefined) {
        return;
      }

      const rootDomain = getRootDomain(tab.url);
      if (!rootDomain) {
        return;
      }

      if (seenRoots.has(rootDomain)) {
        duplicateIds.push(tab.id);
      } else {
        seenRoots.add(rootDomain);
      }
    });

    if (duplicateIds.length > 0) {
      await chrome.tabs.remove(duplicateIds);
    }

    return { removed: duplicateIds.length, scanned: tabs.length };
  }

  function flattenBookmarks(nodes, output) {
    nodes.forEach(function (node) {
      if (node.url) {
        output.push(node);
      }
      if (node.children && node.children.length > 0) {
        flattenBookmarks(node.children, output);
      }
    });
  }

  async function ensureValidFolderId(folderId) {
    const preferred = String(folderId || "");

    if (preferred) {
      try {
        const nodes = await chrome.bookmarks.get(preferred);
        if (nodes && nodes[0] && !nodes[0].url) {
          return nodes[0].id;
        }
      } catch {
        // Fallback to picker default.
      }
    }

    const pickerDefault = resolvePreferredFolderId("");
    if (pickerDefault) {
      return pickerDefault;
    }

    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const rootChildren = root.children || [];
    const fallback = rootChildren.find(function (node) {
      return !node.url;
    }) || root;

    return fallback.id;
  }

  async function getBookmarkSubTreeRoot(folderId) {
    const safeFolderId = await ensureValidFolderId(folderId);
    const subtree = await chrome.bookmarks.getSubTree(safeFolderId);
    return subtree[0];
  }

  async function getBookmarkDomainCountsForFolder(folderId) {
    const root = await getBookmarkSubTreeRoot(folderId);
    const bookmarks = [];
    flattenBookmarks([root], bookmarks);
    const domainMap = createDomainMapFromBookmarks(bookmarks);

    const counts = [];
    domainMap.forEach(function (bookmarkList, domain) {
      counts.push({ domain: domain, count: bookmarkList.length });
    });

    counts.sort(function (a, b) {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.domain.localeCompare(b.domain);
    });

    return counts;
  }

  function countFolderStats(node) {
    let bookmarkCount = 0;
    let childFolderCount = 0;

    (node.children || []).forEach(function (child) {
      if (child.url) {
        bookmarkCount += 1;
        return;
      }

      childFolderCount += 1;
      const nested = countFolderStats(child);
      bookmarkCount += nested.bookmarkCount;
      childFolderCount += nested.childFolderCount;
    });

    return {
      bookmarkCount: bookmarkCount,
      childFolderCount: childFolderCount
    };
  }

  async function getBookmarkFolderSummaries(folderId) {
    const root = await getBookmarkSubTreeRoot(folderId);
    const folders = (root.children || []).filter(function (child) {
      return !child.url;
    });

    const summaries = folders.map(function (folder) {
      const stats = countFolderStats(folder);
      return {
        id: folder.id,
        title: folder.title || "Untitled Folder",
        bookmarkCount: stats.bookmarkCount,
        childFolderCount: stats.childFolderCount
      };
    });

    summaries.sort(function (a, b) {
      if (b.bookmarkCount !== a.bookmarkCount) {
        return b.bookmarkCount - a.bookmarkCount;
      }
      return a.title.localeCompare(b.title);
    });

    return summaries;
  }

  async function removeDuplicateBookmarks(folderId) {
    const root = await getBookmarkSubTreeRoot(folderId);
    const bookmarks = [];
    flattenBookmarks([root], bookmarks);

    const seen = new Set();
    const duplicates = [];

    bookmarks.forEach(function (bookmark) {
      if (!bookmark.url) {
        return;
      }

      const normalized = normalizeUrl(bookmark.url);
      if (!normalized) {
        return;
      }

      if (seen.has(normalized)) {
        duplicates.push(bookmark.id);
      } else {
        seen.add(normalized);
      }
    });

    let removed = 0;
    await Promise.all(
      duplicates.map(async function (bookmarkId) {
        try {
          await chrome.bookmarks.remove(bookmarkId);
          removed += 1;
        } catch {
          // Ignore protected nodes.
        }
      })
    );

    return { removed: removed, scanned: bookmarks.length };
  }

  async function removeDuplicateBookmarksByRootDomain(folderId) {
    const root = await getBookmarkSubTreeRoot(folderId);
    const bookmarks = [];
    flattenBookmarks([root], bookmarks);

    const seenRoots = new Set();
    const duplicates = [];

    bookmarks.forEach(function (bookmark) {
      if (!bookmark.url) {
        return;
      }

      const rootDomain = getRootDomain(bookmark.url);
      if (!rootDomain) {
        return;
      }

      if (seenRoots.has(rootDomain)) {
        duplicates.push(bookmark.id);
      } else {
        seenRoots.add(rootDomain);
      }
    });

    let removed = 0;
    await Promise.all(
      duplicates.map(async function (bookmarkId) {
        try {
          await chrome.bookmarks.remove(bookmarkId);
          removed += 1;
        } catch {
          // Ignore protected nodes.
        }
      })
    );

    return { removed: removed, scanned: bookmarks.length };
  }

  function isLikelyDomainFolder(folderTitle) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(folderTitle || "");
  }

  async function ungroupBookmarksByDomain(folderId) {
    const safeFolderId = await ensureValidFolderId(folderId);
    const subtree = await chrome.bookmarks.getSubTree(safeFolderId);
    const root = subtree[0];

    const directDomainFolders = (root.children || []).filter(function (child) {
      return !child.url && isLikelyDomainFolder(child.title);
    });

    if (directDomainFolders.length === 0) {
      return {
        foldersCleared: 0,
        movedBookmarks: 0
      };
    }

    let movedBookmarks = 0;
    for (const folder of directDomainFolders) {
      const folderTree = await chrome.bookmarks.getSubTree(folder.id);
      const bookmarks = [];
      flattenBookmarks(folderTree, bookmarks);

      for (const bookmark of bookmarks) {
        try {
          await chrome.bookmarks.move(bookmark.id, {
            parentId: safeFolderId
          });
          movedBookmarks += 1;
        } catch {
          // Skip nodes that cannot be moved.
        }
      }

      try {
        await chrome.bookmarks.removeTree(folder.id);
      } catch {
        // Skip folders that cannot be removed.
      }
    }

    return {
      foldersCleared: directDomainFolders.length,
      movedBookmarks: movedBookmarks
    };
  }

  async function groupBookmarksByRootDomain(folderId, minMatches) {
    const threshold = clampThreshold(minMatches);
    const safeFolderId = await ensureValidFolderId(folderId);
    const subtree = await chrome.bookmarks.getSubTree(safeFolderId);
    const root = subtree[0];

    const bookmarks = [];
    flattenBookmarks([root], bookmarks);
    const domainMap = createDomainMapFromBookmarks(bookmarks);

    const candidates = sortDomainEntries(
      Array.from(domainMap.entries()).filter(function (entry) {
        return entry[1].length >= threshold;
      })
    );

    if (candidates.length === 0) {
      return { groupedDomains: 0, movedBookmarks: 0, scanned: bookmarks.length };
    }

    const existingDomainFolders = {};
    const directChildren = root.children || [];
    directChildren.forEach(function (child) {
      if (!child.url && child.title) {
        existingDomainFolders[child.title.toLowerCase()] = child.id;
      }
    });

    let groupedDomains = 0;
    let movedBookmarks = 0;

    for (const candidate of candidates) {
      const domain = candidate[0];
      const domainKey = domain.toLowerCase();
      let targetFolderId = existingDomainFolders[domainKey];

      if (!targetFolderId) {
        const created = await chrome.bookmarks.create({
          parentId: safeFolderId,
          title: domain
        });
        targetFolderId = created.id;
        existingDomainFolders[domainKey] = targetFolderId;
      }

      groupedDomains += 1;
      for (const bookmark of candidate[1]) {
        if (bookmark.parentId !== targetFolderId) {
          await chrome.bookmarks.move(bookmark.id, { parentId: targetFolderId });
          movedBookmarks += 1;
        }
      }
    }

    return { groupedDomains: groupedDomains, movedBookmarks: movedBookmarks, scanned: bookmarks.length };
  }

  function formatDateLabel(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return year + "-" + month + "-" + day + " " + hours + ":" + minutes;
  }

  async function bookmarkAllOpenTabs(folderId) {
    const targetFolderId = await ensureValidFolderId(folderId);
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const bookmarkableTabs = tabs.filter(function (tab) {
      return Boolean(tab.url) && isSupportedUrl(tab.url);
    });

    if (bookmarkableTabs.length === 0) {
      return { created: 0, folderName: "" };
    }

    const folderName = "Berat Tabs " + formatDateLabel(new Date());
    const folder = await chrome.bookmarks.create({
      parentId: targetFolderId,
      title: folderName
    });

    for (const tab of bookmarkableTabs) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: tab.title || tab.url,
        url: tab.url
      });
    }

    return { created: bookmarkableTabs.length, folderName: folderName };
  }

  function collectBookmarkTabEntries(node, path, entries) {
    (node.children || []).forEach(function (child) {
      if (child.url) {
        if (isSupportedUrl(child.url)) {
          entries.push({
            url: child.url,
            groupLabel: path.length > 0 ? path.join(" / ") : null
          });
        }
        return;
      }

      const nextPath = path.concat([child.title || "Folder"]);
      collectBookmarkTabEntries(child, nextPath, entries);
    });
  }

  async function openAllBookmarksAsTabs(openInBackground, folderId) {
    const root = await getBookmarkSubTreeRoot(folderId);
    const entries = [];
    collectBookmarkTabEntries(root, [], entries);

    if (entries.length === 0) {
      return { opened: 0, groupedSets: 0 };
    }

    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id === undefined) {
      throw new Error("Unable to detect active window.");
    }

    const groupedTabIdsByFolder = new Map();
    const batchSize = 25;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async function (entry) {
          const tab = await chrome.tabs.create({
            windowId: currentWindow.id,
            url: entry.url,
            active: !openInBackground
          });

          if (tab.id !== undefined && entry.groupLabel) {
            if (!groupedTabIdsByFolder.has(entry.groupLabel)) {
              groupedTabIdsByFolder.set(entry.groupLabel, []);
            }
            groupedTabIdsByFolder.get(entry.groupLabel).push(tab.id);
          }
        })
      );
    }

    let groupedSets = 0;
    for (const groupEntry of groupedTabIdsByFolder.entries()) {
      const groupLabel = groupEntry[0];
      const tabIds = groupEntry[1];

      if (tabIds.length === 0) {
        continue;
      }

      const groupId = await chrome.tabs.group({ tabIds: tabIds });
      await chrome.tabGroups.update(groupId, {
        title: groupLabel,
        color: pickGroupColor(groupLabel),
        collapsed: false
      });
      groupedSets += 1;
    }

    return { opened: entries.length, groupedSets: groupedSets };
  }

  async function setGroupCollapsed(groupId, collapsed) {
    await chrome.tabGroups.update(groupId, { collapsed: Boolean(collapsed) });
  }

  async function setAllGroupsCollapsed(collapsed) {
    const groups = await chrome.tabGroups.query({
      windowId: chrome.windows.WINDOW_ID_CURRENT
    });

    await Promise.all(
      groups.map(function (group) {
        return chrome.tabGroups.update(group.id, { collapsed: Boolean(collapsed) });
      })
    );

    return groups.length;
  }

  async function ungroupAllTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupedTabs = tabs.filter(function (tab) {
      return tab.id !== undefined && tab.groupId !== undefined && tab.groupId >= 0;
    });

    const tabIds = groupedTabs.map(function (tab) {
      return tab.id;
    });
    const groupIds = new Set(
      groupedTabs.map(function (tab) {
        return tab.groupId;
      })
    );

    if (tabIds.length > 0) {
      await chrome.tabs.ungroup(tabIds);
    }

    return { tabsUngrouped: tabIds.length, groupsCleared: groupIds.size };
  }
})();
