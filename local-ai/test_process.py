import unittest
from process import segments_from_asr, apply_translations, clean_phrases
class PipelineTests(unittest.TestCase):
    def test_segments_use_real_bounds(self):
        raw={'transcription':[{'text':' Hello','offsets':{'from':0,'to':1000}},{'text':'there.','offsets':{'from':900,'to':2200}}]}
        self.assertEqual(segments_from_asr(raw,2),[{'id':'s0','start':0,'end':2,'en':'Hello there.','ru':''}])
    def test_no_speech_is_not_fabricated(self):
        with self.assertRaises(ValueError): segments_from_asr({'transcription':[]},4)
    def test_translation_must_preserve_ids_and_russian(self):
        rows=[{'id':'s0','en':'Hello','ru':''}]
        for response in ({'translations':[]},{'translations':[{'id':'wrong','ru':'Привет'}]},{'translations':[{'id':'s0','ru':'Hello'}]}):
            with self.assertRaises(ValueError):apply_translations(rows,response)
        apply_translations(rows,{'translations':[{'id':'s0','ru':'Привет'}]});self.assertEqual(rows[0]['en'],'Hello');self.assertEqual(rows[0]['ru'],'Привет')
    def test_only_exact_source_expressions(self):
        rows=[{'id':'s0','en':'Pick up the load.'}]
        entries=[{'segmentId':'s0','expression':s,'meaning':'Значение'} for s in ['Pick up','pick up','load','road','up the loa']]
        self.assertEqual([p['expression'] for p in clean_phrases(rows,{'phrases':entries})],['Pick up','load'])
if __name__=='__main__':unittest.main()

class AudioFormatTests(unittest.TestCase):
    def test_classic_and_extensible_pcm_duration(self):
        import struct,tempfile
        from pathlib import Path
        from process import wav_duration,validate_document
        for tag in [1,65534]:
            fmt=struct.pack('<HHIIHH',tag,1,16000,32000,2,16)
            if tag==65534:fmt+=struct.pack('<HHI',22,16,4)+bytes.fromhex('0100000000001000800000aa00389b71')
            data=b'fmt '+struct.pack('<I',len(fmt))+fmt+b'data'+struct.pack('<I',3200)+bytes(3200)
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'qa.wav';p.write_bytes(b'RIFF'+struct.pack('<I',4+len(data))+b'WAVE'+data)
                self.assertAlmostEqual(wav_duration(p),.1)
                p.write_bytes(p.read_bytes()[:-3])
                with self.assertRaises(ValueError):wav_duration(p)
    def test_resume_rejects_bad_times(self):
        from process import validate_document
        doc={'format':'english-flow-transcript','version':1,'audio':{'sha256':'a'*64,'size':10,'duration':2},'segments':[{'id':'s0','en':'Hello','start':0,'end':1}]}
        validate_document(doc);doc['segments'][0]['end']=float('nan')
        with self.assertRaises(ValueError):validate_document(doc)
