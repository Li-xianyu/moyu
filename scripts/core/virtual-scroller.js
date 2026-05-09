// Lightweight virtual scroller — spacer-based, flexbox-friendly, zero CSS changes.
// Renders only items within viewport (± overscan), using top/bottom spacers to
// preserve scroll height and flex gap layout.

function createVirtualScroller(options) {
  var scrollEl = options.scrollElement;
  var contentEl = options.contentElement;
  var estimateHeight = options.estimateHeight || 120;
  var overscan = options.overscan || 6;
  var onChange = options.onChange || function () {};

  var itemHeights = [];
  var itemKeys = [];
  var totalCount = 0;
  var prevRange = { startIndex: -1, endIndex: -1 };
  var resizeObserver = null;
  var ticking = false;

  function getHeight(index) {
    return itemHeights[index] || estimateHeight;
  }

  function setCount(count) {
    totalCount = count;
    itemHeights.length = count;
    for (var i = 0; i < count; i++) {
      if (!itemHeights[i]) itemHeights[i] = 0;
    }
  }

  function setKeys(keys) {
    itemKeys = keys;
  }

  function getOffset(untilIndex) {
    var offset = 0;
    for (var i = 0; i < untilIndex && i < totalCount; i++) {
      offset += getHeight(i);
    }
    return offset;
  }

  function getTotalHeight() {
    return getOffset(totalCount);
  }

  function computeRange() {
    var scrollTop = scrollEl.scrollTop;
    var viewH = scrollEl.clientHeight || window.innerHeight;
    var overscanPx = overscan * estimateHeight;

    var startIndex = -1;
    var endIndex = -1;
    var offset = 0;

    for (var i = 0; i < totalCount; i++) {
      var h = getHeight(i);
      if (startIndex === -1 && offset + h > scrollTop - overscanPx) {
        startIndex = i;
      }
      if (offset < scrollTop + viewH + overscanPx) {
        endIndex = i;
      } else {
        break;
      }
      offset += h;
    }

    if (startIndex === -1) startIndex = 0;
    if (endIndex === -1) endIndex = totalCount - 1;
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(totalCount - 1, endIndex);

    var topOffset = getOffset(startIndex);

    return {
      startIndex: startIndex,
      endIndex: endIndex,
      topOffset: topOffset,
      totalHeight: getTotalHeight(),
    };
  }

  function notifyIfChanged() {
    var range = computeRange();
    var prev = prevRange;
    if (prev.startIndex !== range.startIndex ||
        prev.endIndex !== range.endIndex ||
        Math.abs((prev.totalHeight || 0) - range.totalHeight) > 4 ||
        Math.abs((prev.topOffset || 0) - range.topOffset) > 4) {
      prevRange = range;
      onChange(range);
    }
  }

  function scheduleNotify() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        notifyIfChanged();
      });
    }
  }

  function attach() {
    scrollEl.addEventListener("scroll", scheduleNotify, { passive: true });
    window.addEventListener("resize", scheduleNotify);

    // Observe rendered items to track actual heights
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(function (entries) {
        var changed = false;
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i].target;
          var index = parseInt(el.dataset.virtualIndex, 10);
          if (isNaN(index) || index < 0 || index >= totalCount) continue;
          var mb = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
          var newH = el.offsetHeight + mb;
          if (newH > 0 && itemHeights[index] !== newH) {
            itemHeights[index] = newH;
            changed = true;
          }
        }
        if (changed) scheduleNotify();
      });
    }
  }

  function observeElement(el, index) {
    if (resizeObserver && el) {
      el.dataset.virtualIndex = index;
      resizeObserver.observe(el);
      // Set initial height synchronously (include margin-bottom)
      var mb = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
      var h = el.offsetHeight + mb;
      if (h > 0 && itemHeights[index] !== h) {
        itemHeights[index] = h;
      }
    }
  }

  function unobserveElement(el) {
    if (resizeObserver && el) {
      resizeObserver.unobserve(el);
    }
  }

  function destroy() {
    scrollEl.removeEventListener("scroll", scheduleNotify);
    window.removeEventListener("resize", scheduleNotify);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  function getVisibleRange() {
    return computeRange();
  }

  function forceUpdate() {
    prevRange = { startIndex: -1, endIndex: -1 };
    notifyIfChanged();
  }

  function scrollToIndex(index, align) {
    if (align === void 0) align = "start";
    var top = getOffset(index);
    if (align === "end") {
      top = top - (scrollEl.clientHeight || window.innerHeight) + estimateHeight;
    }
    if (align === "center") {
      top = top - (scrollEl.clientHeight || window.innerHeight) / 2;
    }
    scrollEl.scrollTop = Math.max(0, top);
    forceUpdate();
  }

  function scrollToBottom() {
    scrollEl.scrollTop = scrollEl.scrollHeight;
    forceUpdate();
  }

  var api = {
    setCount: setCount,
    setKeys: setKeys,
    getVisibleRange: getVisibleRange,
    attach: attach,
    observeElement: observeElement,
    unobserveElement: unobserveElement,
    destroy: destroy,
    forceUpdate: forceUpdate,
    scrollToIndex: scrollToIndex,
    scrollToBottom: scrollToBottom,
    getOffset: getOffset,
    getTotalHeight: getTotalHeight,
    getHeight: getHeight,
  };

  return api;
}
