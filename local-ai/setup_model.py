import os, subprocess
from process import LocalModel, MODEL, request
with LocalModel():
    subprocess.run(['ollama','pull',MODEL],env=dict(os.environ,OLLAMA_HOST='127.0.0.1:11435'),check=True)
    print('Player models ready:',[(m['name'],m['digest']) for m in request('/api/tags')['models']])
