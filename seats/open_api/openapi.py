from .registry import registry


def build_openapi_schema(base_url='/open_api', *, request=None):
    tools = registry.schemas(request=request)
    tool_names = [tool['function']['name'] for tool in tools]
    return {
        'openapi': '3.0.3',
        'info': {
            'title': 'FuckSeats Open API',
            'version': '0.3.0',
            'description': '面向外部 Agent 的不想排座位开放接口。',
        },
        'servers': [{'url': base_url}],
        'security': [{'bearerAuth': []}],
        'paths': {
            '/': {
                'get': {
                    'summary': 'API 发现根节点',
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms': {
                'get': {
                    'summary': '列出教室',
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}': {
                'get': {
                    'summary': '教室详情',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}/enums': {
                'get': {
                    'summary': '枚举值',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}/seats': {
                'get': {
                    'summary': '读取具体座位排列',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}/students': {
                'get': {
                    'summary': '读取班级名单与学生资料',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/access/authorize': {
                'post': {
                    'summary': '在应用界面弹出授权窗口，申请本次运行期间的访问凭证',
                    'security': [],
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {
                                    'type': 'object',
                                    'properties': {
                                        'client_name': {'type': 'string', 'maxLength': 80},
                                        'scope': {'type': 'string', 'enum': ['full', 'read'], 'default': 'full'},
                                        'reason': {'type': 'string', 'maxLength': 200},
                                    },
                                    'required': ['client_name'],
                                },
                            },
                        },
                    },
                    'responses': {
                        '202': {'description': '已弹出授权窗口，返回 token 与 request_id'},
                        '403': {'description': '仅接受本机程序'}, '429': {'description': '待确认的申请过多'},
                    },
                },
            },
            '/access/status': {
                'get': {
                    'summary': '查询本次运行的授权状态',
                    'responses': {
                        '200': {'description': '已授权'}, '202': {'description': '等待用户授权'},
                        '401': {'description': '凭证无效或已失效'}, '403': {'description': '用户拒绝'},
                    },
                },
            },
            '/tools/execute': {
                'post': {
                    'summary': '执行单个工具',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {
                                    'type': 'object',
                                    'properties': {
                                        'tool': {'type': 'string', 'enum': tool_names},
                                        'classroom_id': {'type': 'integer'},
                                        'arguments': {'type': 'object'},
                                    },
                                    'required': ['tool'],
                                },
                            },
                        },
                    },
                    'responses': {'200': {'description': 'OK'}, '400': {'description': 'Error'}},
                },
            },
            '/tools/batch': {
                'post': {
                    'summary': '原子化批量执行工具',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {
                                    'type': 'object',
                                    'properties': {
                                        'classroom_id': {'type': 'integer'},
                                        'operations': {
                                            'type': 'array',
                                            'items': {
                                                'type': 'object',
                                                'properties': {
                                                    'tool': {'type': 'string', 'enum': tool_names},
                                                    'classroom_id': {'type': 'integer'},
                                                    'arguments': {'type': 'object'},
                                                },
                                                'required': ['tool'],
                                            },
                                        },
                                    },
                                    'required': ['operations'],
                                },
                            },
                        },
                    },
                    'responses': {'200': {'description': 'OK'}, '400': {'description': 'Error'}},
                },
            },
        },
        'components': {
            'securitySchemes': {
                'bearerAuth': {'type': 'http', 'scheme': 'bearer'},
            },
            'schemas': {
                'Tool': {'type': 'object'},
            },
        },
        'x-tools': tools,
    }
