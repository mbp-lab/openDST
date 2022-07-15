export function calculateHeightInPx(vwHeight) {
    return document.documentElement.clientHeight * vwHeight / 100
}

export function calculateWidthInPx(vwWidth){
    return document.documentElement.clientWidth * vwWidth / 100
}