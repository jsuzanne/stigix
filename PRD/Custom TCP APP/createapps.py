#!/usr/bin/env python
"""
CGNX script to create custom applications

tanushree@cloudgenix.com

"""
import cloudgenix
import pandas as pd
import os
import sys
import yaml
from netaddr import IPAddress, IPNetwork
from random import *
import argparse
import logging
import datetime


# Global Vars
SDK_VERSION = cloudgenix.version
SCRIPT_NAME = 'CloudGenix: Create Custom Apps'


# Set NON-SYSLOG logging to use function name
logger = logging.getLogger(__name__)

try:
    from cloudgenix_settings import CLOUDGENIX_AUTH_TOKEN

except ImportError:
    # will get caught below.
    # Get AUTH_TOKEN/X_AUTH_TOKEN from env variable, if it exists. X_AUTH_TOKEN takes priority.
    if "X_AUTH_TOKEN" in os.environ:
        CLOUDGENIX_AUTH_TOKEN = os.environ.get('X_AUTH_TOKEN')
    elif "AUTH_TOKEN" in os.environ:
        CLOUDGENIX_AUTH_TOKEN = os.environ.get('AUTH_TOKEN')
    else:
        # not set
        CLOUDGENIX_AUTH_TOKEN = None

try:
    from cloudgenix_settings import CLOUDGENIX_USER, CLOUDGENIX_PASSWORD

except ImportError:
    # will get caught below
    CLOUDGENIX_USER = None
    CLOUDGENIX_PASSWORD = None


global_pfid_name_dict = {}
global_pfname_id_dict = {}
local_pfid_name_dict = {}
local_pfname_id_dict = {}
yamlreplace = {}


def createdicts(cgx_session):
    # resp = cgx_session.get.localprefixfilters()
    # if resp.cgx_status:
    #     filters = resp.cgx_content.get("items", None)
    #
    #     for pf in filters:
    #         local_pfid_name_dict[pf['id']] = pf['name']
    #         local_pfname_id_dict[pf['name']] = pf['id']
    #
    # else:
    #     print("ERR: Could not query local prefix filters")

    print("INFO: Getting Global Prefix Filters")
    resp = cgx_session.get.globalprefixfilters()
    if resp.cgx_status:
        filters = resp.cgx_content.get("items", None)

        for pf in filters:
            global_pfid_name_dict[pf['id']] = pf['name']
            global_pfname_id_dict[pf['name']] = pf['id']

    else:
        print("ERR: Could not query global prefix filters")

    return


def cleanexit(cgx_session):
    cgx_session.get.logout()
    sys.exit()

def createcustomapps(yamldata, cgx_session):
    appconfig = yamldata.get("apps", None)

    for app in appconfig.keys():

        config = appconfig[app]

        iprules = config.get("ip_rules", None)
        if iprules is not None:
            for i, rule in enumerate(iprules):
                dstfilter = rule.get("dest_filters", None)
                if dstfilter is not None:
                    for dj, df in enumerate(dstfilter):
                        if df in global_pfname_id_dict.keys():
                            pfid = global_pfname_id_dict[df]
                            config["ip_rules"][i]["dest_filters"][dj] = pfid
                            yamlreplace[df] = pfid
                        else:
                            print("ERR: IP Rule Destination Prefix Filter {} not found. Please reenter the Prefix Filter for {}".format(df, app))
                            cleanexit(cgx_session)

                srcfilter = rule.get("src_filters", None)
                if srcfilter is not None:
                    for sj, sf in enumerate(srcfilter):
                        if sf in global_pfname_id_dict.keys():
                            pfid = global_pfname_id_dict[sf]
                            config["ip_rules"][i]["src_filters"][sj] = pfid
                            yamlreplace[sf] = pfid
                        else:
                            print("ERR: IP Rule Source Prefix Filter {} not found. Please reenter the Prefix Filter for {}".format(sf, app))
                            cleanexit(cgx_session)

        tcprules = config.get("tcp_rules", None)
        if tcprules is not None:
            for i, rule in enumerate(tcprules):
                client_filters = rule.get("client_filters", None)
                if client_filters is not None:

                    for clj, clf in enumerate(client_filters):
                        if clf in global_pfname_id_dict.keys():
                            pfid = global_pfname_id_dict[clf]
                            config["tcp_rules"][i]["client_filters"][clj] = pfid
                            yamlreplace[clf] = pfid
                        else:
                            print("ERR: TCP Client Prefix Filter {} not found. Please reenter the Prefix Filter for {}".format(clf, app))
                            cleanexit(cgx_session)

                server_filters = rule.get("server_filters", None)
                if server_filters is not None:
                    for srj, srf in enumerate(server_filters):
                        if srf in global_pfname_id_dict.keys():
                            pfid = global_pfname_id_dict[srf]
                            config["tcp_rules"][i]["server_filters"][srj] = pfid
                            yamlreplace[srf] = pfid
                        else:
                            print("ERR: TCP Server Prefix Filter {} not found. Please reenter the Prefix Filter for {}".format(srf, app))
                            cleanexit(cgx_session)

        udprules = config.get("udp_rules", None)
        if udprules is not None:

            for i, rule in enumerate(udprules):
                udp_filters = rule.get("udp_filters", None)
                if udp_filters is not None:
                    for uj, uf in enumerate(udp_filters):
                        if uf in global_pfname_id_dict.keys():
                            pfid = global_pfname_id_dict[uf]
                            config["udp_rules"][i]["udp_filters"][uj] = pfid
                            yamlreplace[uf] = pfid
                        else:
                            print("ERR: UDP Prefix Filter {} not found. Please reenter the Prefix Filter for {}".format(uf, app))
                            cleanexit(cgx_session)


        resp = cgx_session.post.appdefs(data=config, api_version="v2.3")
        if resp.cgx_status:
            print("SUCCESS: Custom App {} created".format(app))

        else:
            print("ERR: Could not create Custom App {}".format(app))
            cloudgenix.jd_detailed(resp)

    return

def go():
    ############################################################################
    # Begin Script, parse arguments.
    ############################################################################

    # Parse arguments
    parser = argparse.ArgumentParser(description="{0}.".format(SCRIPT_NAME))

    # Allow Controller modification and debug level sets.
    controller_group = parser.add_argument_group('API', 'These options change how this program connects to the API.')
    controller_group.add_argument("--controller", "-C",
                                  help="Controller URI, ex. "
                                       "C-Prod: https://api.elcapitan.cloudgenix.com",
                                  default="https://api.elcapitan.cloudgenix.com")

    login_group = parser.add_argument_group('Login', 'These options allow skipping of interactive login')
    login_group.add_argument("--email", "-E", help="Use this email as User Name instead of prompting",
                             default=None)
    login_group.add_argument("--pass", "-P", help="Use this Password instead of prompting",
                             default=None)

    # Commandline for entering Site info
    app_group = parser.add_argument_group('Custom Application specific information',
                                           'Information shared here will be used to create custom applications')
    app_group.add_argument("--configfile", "-f", help="YAML file containing application details", default=None)

    args = vars(parser.parse_args())

    ############################################################################
    # Instantiate API & Login
    ############################################################################

    cgx_session = cloudgenix.API(controller=args["controller"], ssl_verify=False)
    print("{0} v{1} ({2})\n".format(SCRIPT_NAME, SDK_VERSION, cgx_session.controller))

    # login logic. Use cmdline if set, use AUTH_TOKEN next, finally user/pass from config file, then prompt.
    # figure out user
    if args["email"]:
        user_email = args["email"]
    elif CLOUDGENIX_USER:
        user_email = CLOUDGENIX_USER
    else:
        user_email = None

    # figure out password
    if args["pass"]:
        user_password = args["pass"]
    elif CLOUDGENIX_PASSWORD:
        user_password = CLOUDGENIX_PASSWORD
    else:
        user_password = None

    # check for token
    if CLOUDGENIX_AUTH_TOKEN and not args["email"] and not args["pass"]:
        cgx_session.interactive.use_token(CLOUDGENIX_AUTH_TOKEN)
        if cgx_session.tenant_id is None:
            print("AUTH_TOKEN login failure, please check token.")
            sys.exit()

    else:
        while cgx_session.tenant_id is None:
            cgx_session.interactive.login(user_email, user_password)
            # clear after one failed login, force relogin.
            if not cgx_session.tenant_id:
                user_email = None
                user_password = None

    filename = args["configfile"]
    if filename is None:
        print("ERR: Please provide the path to the YAML config file")
        cleanexit(cgx_session)

    ############################################################################
    # Read YAML Contents
    # Build Translation Dicts
    # Create Custom Apps
    ############################################################################
    if os.path.exists(filename):
        with open(filename) as yamlfile:
            yamldata = yaml.load(yamlfile, Loader=yaml.FullLoader)
            createdicts(cgx_session)
            createcustomapps(yamldata, cgx_session)
    else:
        print("ERR: Invalid config file. File {} not found".format(filename))
        cleanexit(cgx_session)

    ############################################################################
    # Logout to clear session.
    ############################################################################

    print("INFO: Logging Out")
    cleanexit(cgx_session)


if __name__ == "__main__":
    go()
