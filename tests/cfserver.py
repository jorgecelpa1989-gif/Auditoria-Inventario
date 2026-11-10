import http.server,sys,os
root=sys.argv[1];port=int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=root,**k)
    def log_message(s,*a): pass
    def do_GET(s):
        p=s.path.split('?')[0]
        if p.endswith('/index.html'):
            s.send_response(307);s.send_header('Location',s.path.replace('index.html','',1));s.end_headers();return
        return super().do_GET()
http.server.ThreadingHTTPServer(('127.0.0.1',port),H).serve_forever()
