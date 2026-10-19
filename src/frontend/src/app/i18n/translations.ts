
export interface Translations {
  // Page
  pageTitle: string;
  // Topbar buttons
  displaySettings: string;
  menuTitle: string;
  menuClose: string;
  menuRanking: string;
  rankingTitle: string;
  rankingNone: string;
  rankingBack: string;
  rankingRank: string;
  rankingName: string;
  rankingTime: string;
  rankingGap: string;
  rankingLive: string;
  menuLogs: string;
  logsTitle: string;
  logsNone: string;
  logsNew: string;
  logsNoChange: string;
  logsPast: string; // said before the name of a skater whose update is about a heat that was over
  logsUpdate: string; // contains {n}: the number of the batch of updates that arrived together
  logsFieldHeat: string;
  logsFieldLane: string;
  logsFieldLap: string;
  logsFieldTime: string;
  logsFieldRank: string;
  logsFieldStatus: string;
  logsFieldRemark: string;
  menuStartList: string;
  menuMain: string;
  menuSettings: string;
  menuCreditBy: string;
  menuCreditFree: string;
  settingsTitle: string;
  startListTitle: string;
  startListNone: string;
  startListSearch: string;
  startListPlaceholder: string;
  startListClear: string;
  startListFiltered: string;
  startListNoMatch: string;
  startListNext: string;
  startListAhead: string;
  startListAllDone: string;
  startListDone: string;
  startListThisHeat: string;
  massStartSettings: string;
  generalSettings: string;
  todayCompetitionsLabel: string;
  noCompetitionOption: string;
  selectCompetitionHint: string;
  noLiveCompetitionsHint: string;
  colorSchemeLabel: string;
  colorSchemeAuto: string;
  colorSchemeOn: string;
  colorSchemeOff: string;
  colorSchemePopoverTitle: string;
  colorSchemePopoverBody: string;
  animationsLabel: string;
  animationsPopoverTitle: string;
  animationsPopoverBody: string;
  thousandthsLabel: string;
  hundredthsLabel: string;
  thousandthsPopoverTitle: string;
  thousandthsOnBody: string;
  thousandthsOffBody: string;
  feedNotLiveTitle: string;
  feedNotLiveBody: string;
  feedSourceMessage: string;
  disclaimer: string;
  disclaimerOwnership: string;
  feedUnavailableTitle: string;
  feedUnavailableBody: string;
  feedEmptyTitle: string;
  feedEmptyBody: string;
  feedNoCompetitionTitle: string;
  feedNoCompetitionBody: string;
  feedDisconnectedTitle: string;
  feedDisconnectedBody: string;
  feedSlowTitle: string;
  feedSlowBody: string;
  tooltipDistance: string;
  tooltipLapTime: string;
  tooltipTotalTime: string;
  sliderLabel: string;
  sliderMore: string;   // contains {n}
  sliderYou: string;    // the label under the slider thumb when it is not on the live heat
  sliderEnd: string;    // the label at the right end of the slider
  peekStart: string;    // the grey hint left of the first heat of a distance
  peekEnd: string;      // the grey hint right of the last heat of a distance
  futureLap: string;
  // Max gap setting
  maxGapLabel: string;
  timelineLabel: string;
  maxGapPopoverBody: string;
  // Max groups setting
  maxGroupsLabel: string;
  maxGroupsPopoverBody: string;
  // Lap variance setting
  lapDeltaLabel: string;
  lapVariancePopoverTitle: string;
  lapVariancePopoverBody: string;
  lapVariancePopoverExample: string;
  // Badges
  badgeLive: string;
  badgeDone: string;
  badgeLeader: string;
  badgeFinalLap: string;
  // Distance header
  lapUnit: string;
  lapsUnit: string;
  // Groups / heats
  headOfRace: string;
  tailOfRace: string;
  groupLabel: string;  // contains {n}
  heatLabel: string;   // contains {n}
  lapStepLabel: string; // contains {n}
  announceFinished: string; // contains {name} and {time}; read out by a screen reader when a skater finishes
  announceFinishedMany: string; // contains {n}
  laneWhite: string; // the lane of a skater, said by a screen reader on the card; the lanes are told apart by colour
  laneRed: string;
  laneYellow: string;
  laneBlue: string;
  // Race events
  lapCompleted: string;
  finished: string;
  finishLabel: string;
  finishedUnofficial: string;
  // Individual personal best label and remarks
  pbCurrentLabel: string;
  pbPreviousLabel: string;
  remarkNewPb: string;
  remarkShortPb: string;
  pbImprovedTitle: string;
  remarkFall: string;
  remarkDisqualified: string;
  remarkDidNotStart: string;
  remarkDidNotFinish: string;
  remarkWithdrawn: string;
  remarkManualTime: string;
  genderWomen: string;
  genderMen: string;
  categoryPupils: string;
  categoryJuniors: string;
  categoryNeoSeniors: string;
  categorySeniors: string;
  categoryMasters: string;
  remarkWorldRecord: string;
  remarkNationalRecord: string;
  remarkNewTrackRecord: string;
  remarkTrackRecordCourse: string;
  // Mass start lap counter (HTML, contains underline span)
  moreLapAfterRound: string;   // singular
  moreLapsAfterRound: string;  // plural
}
