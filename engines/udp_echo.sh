#! /usr/bin/env python

import argparse
from socket import *

ECHO_PORT = 6100
BUFSIZE = 1024

if __name__ == "__main__":

    # parse arguments
    parser = argparse.ArgumentParser()

    # Allow Controller modification and debug level sets.
    binding_group = parser.add_argument_group('Binding', 'These options change how traffic is bound.')
    binding_group.add_argument("--ip", help="IP to listen on. (Default ALL)",
                               type=str, default="0.0.0.0")
    binding_group.add_argument("--port",
                               help="Port to listen on. (Default is 6100)", type=int,
                               default=6100)

    args = vars(parser.parse_args())

    s = socket(AF_INET, SOCK_DGRAM)
    s.setsockopt(SOL_SOCKET, SO_REUSEADDR, 1)
    try:
        s.setsockopt(SOL_SOCKET, SO_REUSEPORT, 1)
    except: pass
    s.bind((args['ip'], args['port']))
    print('UDP echo server {0} ready on port {1}'.format(s.getsockname()[0], s.getsockname()[1]))
    while 1:
        data, addr = s.recvfrom(BUFSIZE)
        # print('server received data from %r' % (addr))
        s.sendto(data, addr)

