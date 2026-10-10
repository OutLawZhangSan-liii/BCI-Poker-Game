import unittest
import numpy as np
from .algorithms import bandpass,cca_scores,train_trca,trca_scores,verification
from .analyze import spectral_metrics,decision,choose_settings,load_trials

class AlgorithmsTest(unittest.TestCase):
    def test_reference_and_independent_targets(self):
        self.assertTrue(verification()["passed"])
        rng=np.random.default_rng(19);fs=250;t=np.arange(1000)/fs
        for frequencies in ([12,15],[7.5,8.57,10,12],[7.5,8.57,10,12,13.33,14]):
            for cue,f in enumerate(frequencies):
                x=bandpass(np.sin(2*np.pi*f*t)[:,None]*np.array([[1,.8,.6,.9]])+rng.normal(0,.1,(1000,4))+20000,fs)[375:]
                self.assertEqual(int(np.argmax(cca_scores(x,fs,frequencies))),cue)
    def test_baseline_and_missing_training(self):
        filtered=bandpass(np.full((2500,4),150000.),250)
        self.assertLess(np.max(np.abs(filtered)),1e-8)
        with self.assertRaisesRegex(ValueError,"independent"):
            train_trca([np.zeros((500,4))],[0],2)
    def test_snr_masks_other_targets_and_cutoff(self):
        fs=250;t=np.arange(2000)/fs;x=np.sin(2*np.pi*14*t)[:,None]*np.ones((1,4))
        metrics=spectral_metrics(x,fs,[7.5,8.57,10,12,13.33,14],5)
        guard=2/8
        for row in metrics:
            for n in row.get('noiseFrequencies',[]):
                self.assertTrue(all(abs(n-f*h)>guard for f in [7.5,8.57,10,12,13.33,14] for h in [1,2,3] if f*h<=45))
        cutoff=spectral_metrics(x,fs,[12,15],1)[2]
        self.assertIsNone(cutoff['snrDb'])
    def test_trial_decision_does_not_repair_an_early_wrong_selection(self):
        rows=[{'candidate':cue,'cue':1,'margin':.5,'confidence':.8,'endSeconds':end,'elapsedMs':1} for cue,end in [(0,3),(0,3.25),(1,3.5),(1,3.75)]]
        result=decision(rows,.1)
        self.assertEqual(result['candidate'],0);self.assertEqual(result['firstCorrectTime'],3.75)
    def test_settings_are_selected_per_configuration(self):
        metrics=[{'appearance':'solid','count':2,'method':'CCA','seconds':seconds,'policy':'0.0','balancedAccuracy':accuracy,'rejectionRate':0} for seconds,accuracy in [(2,.5),(3,.8),(4,.7)]]
        self.assertEqual(choose_settings(metrics)[0]['seconds'],3)

if __name__=='__main__':unittest.main()
