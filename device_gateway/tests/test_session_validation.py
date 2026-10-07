import unittest

from device_gateway.validate_session import validate_markers


def _start(trial_id: str, sample_index: int, teaching: bool = True, count: int = 3) -> dict:
    targets = [
        {"id": f"teaching_target_{index}", "frequencyHz": frequency, "phaseRad": index * 1.57,
         "x": position, "y": 0.5}
        for index, (frequency, position) in enumerate(zip((10, 12, 15, 18), (0.22, 0.5, 0.78, 0.95)))
    ][:count]
    marker = {"markerType": "stimulus_start", "trialId": trial_id, "markerSampleIndex": str(sample_index),
              "trialKind": "teaching" if teaching else "online", "targets": targets}
    if teaching:
        marker["stimulusGeometry"] = {"version": "teaching-geometry-v3", "referenceVisible": False,
                                       "layout": "horizontal-single-row"}
    return marker


class SessionValidationTests(unittest.TestCase):
    def test_zero_frequency_is_only_valid_for_explicit_static_control(self) -> None:
        marker = _start("static", 100, teaching=False, count=1)
        marker.update({"trialKind": "timing_diagnostic", "comparisonProtocol": "central-solid-evocation-v1",
                       "condition": "static", "modulationAmplitude": 0, "activeTargetIds": []})
        marker["targets"][0]["frequencyHz"] = 0
        end = {"markerType": "stimulus_end", "trialId": "static"}
        self.assertEqual(validate_markers([marker, end])["starts"], 1)
        for appearance in ("card", "solid"):
            current = {**marker, "comparisonProtocol": "central-appearance-comparison-v1", "targetAppearance": appearance}
            self.assertEqual(validate_markers([current, end])["starts"], 1)
            with self.assertRaises(ValueError):
                validate_markers([{**current, "modulationAmplitude": .45}, end])
        for appearance in ("card-face", "solid"):
            current = {**marker, "comparisonProtocol": "central-cardface-comparison-v1", "targetAppearance": appearance}
            self.assertEqual(validate_markers([current, end])["starts"], 1)
            with self.assertRaises(ValueError): validate_markers([{**current, "activeTargetIds": ["teaching_target_0"]}, end])
        for appearance in ("card", "card-face", "solid"):
            current = {**marker, "comparisonProtocol": "central-three-form-comparison-v1", "targetAppearance": appearance}
            self.assertEqual(validate_markers([current, end])["starts"], 1)
            with self.assertRaises(ValueError): validate_markers([{**current, "modulationAmplitude": .45}, end])
            for mode in ("fixed","synchronous"):
                short = {**current,"comparisonProtocol":"central-short-fixation-comparison-v1","fixationMode":mode}
                self.assertEqual(validate_markers([short,end])["starts"],1)
                with self.assertRaises(ValueError): validate_markers([{**short,"modulationAmplitude":.45},end])
        for override in ({"modulationAmplitude": .45}, {"activeTargetIds": ["teaching_target_0"]},
                         {"condition": "12hz"}, {"trialKind": "online"}):
            with self.assertRaises(ValueError):
                validate_markers([{**marker, **override}, end])

    def test_valid_teaching_mapping_is_replayable(self) -> None:
        summary = validate_markers([_start("t1", 100, count=4), {"markerType": "stimulus_end", "trialId": "t1"}])
        self.assertEqual(summary, {"starts": 1, "ends": 1, "teaching": 1})

    def test_expanded_principle_layout_and_historical_layout_are_replayable(self) -> None:
        for count in (2,3,4):
            marker = _start("expanded",100,count=count)
            marker.update(teachingMode="principle",stimulusGeometry={"version":"teaching-geometry-v4","referenceVisible":False,
                          "layout":"grid-2x2" if count==4 else "horizontal-single-row","targetSize":"teaching-fill"})
            end={"markerType":"stimulus_end","trialId":"expanded"}
            self.assertEqual(validate_markers([marker,end])["starts"],1)
            with self.assertRaises(ValueError):validate_markers([{**marker,"teachingMode":"operation"},end])
            wrong={**marker,"stimulusGeometry":{**marker["stimulusGeometry"],"layout":"horizontal-single-row" if count==4 else "grid-2x2"}}
            with self.assertRaises(ValueError):validate_markers([wrong,end])

    def test_enlarged_single_row_principle_layout_is_replayable(self) -> None:
        for count in (2, 3, 4):
            marker = _start("single-row", 100, count=count)
            marker.update(teachingMode="principle", stimulusGeometry={"version":"teaching-geometry-v5", "referenceVisible":False,
                          "layout":"horizontal-single-row", "targetSize":"teaching-fill"})
            end = {"markerType":"stimulus_end", "trialId":"single-row"}
            self.assertEqual(validate_markers([marker, end])["starts"], 1)
            with self.assertRaises(ValueError): validate_markers([{**marker, "teachingMode":"operation"}, end])
            wrong = {**marker, "stimulusGeometry":{**marker["stimulusGeometry"], "layout":"grid-2x2"}}
            with self.assertRaises(ValueError): validate_markers([wrong, end])

    def test_rejects_duplicate_frequency(self) -> None:
        marker = _start("t1", 100, count=3)
        marker["targets"][2]["frequencyHz"] = 12
        with self.assertRaisesRegex(ValueError, "frequencies must be unique"):
            validate_markers([marker, {"markerType": "stimulus_end", "trialId": "t1"}])

    def test_rejects_unmatched_end(self) -> None:
        with self.assertRaisesRegex(ValueError, "no matching"):
            validate_markers([_start("t1", 100)])

    def test_rejects_non_monotonic_starts(self) -> None:
        with self.assertRaisesRegex(ValueError, "monotonic"):
            validate_markers([_start("t1", 200), _start("t2", 100),
                              {"markerType": "stimulus_end", "trialId": "t1"},
                              {"markerType": "stimulus_end", "trialId": "t2"}])


if __name__ == "__main__":
    unittest.main()
